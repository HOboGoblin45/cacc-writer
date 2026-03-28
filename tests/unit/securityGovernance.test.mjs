/**
 * tests/unit/securityGovernance.test.mjs
 * ----------------------------------------
 * Unit tests for Phase 15 Security/Governance:
 *   - User management
 *   - Access control
 *   - Data retention
 *   - Compliance checking
 */

import assert from 'assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

let passed = 0;
let failed = 0;
const failures = [];

async function test(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  OK   ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  FAIL ' + label);
    console.log('       ' + err.message);
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-security-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'security-test.db');

const { getDb } = await import('../../server/db/database.js');
getDb();

const {
  createUser, getUser, getUserByUsername, listUsers,
  updateUser, deactivateUser, suspendUser, reactivateUser,
  recordLogin, recordFailedLogin, getUserPermissions,
} = await import('../../server/security/userService.js');

const {
  checkAccess, createPolicy, listPolicies, getDefaultPolicies,
  seedDefaultPolicies, logAccess, getAccessLog, getAccessStats,
} = await import('../../server/security/accessControlService.js');

const {
  createRetentionRule, listRetentionRules, getRetentionRule,
  updateRetentionRule, runRetentionCheck, getRetentionSummary,
  seedDefaultRules,
} = await import('../../server/security/retentionService.js');

const {
  createComplianceRecord, listComplianceRecords,
  getCaseComplianceStatus, getComplianceSummary,
} = await import('../../server/security/complianceService.js');

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedCase(caseId) {
  const db = getDb();
  try {
    db.prepare(`INSERT INTO case_records (case_id, form_type) VALUES (?, '1004')`).run(caseId);
    db.prepare(`INSERT INTO case_facts (case_id, facts_json, provenance_json, updated_at)
      VALUES (?, '{}', '{}', datetime('now'))`).run(caseId);
  } catch { /* may already exist */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════

let adminUserId;

await test('createUser creates user with role', () => {
  const result = createUser({
    username: 'admin_user',
    display_name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
  });
  assert.ok(result.id.startsWith('usr_'), 'should have usr_ prefix');
  adminUserId = result.id;

  const user = getUser(adminUserId);
  assert.equal(user.username, 'admin_user');
  assert.equal(user.role, 'admin');
  assert.equal(user.status, 'active');
});

await test('getUserByUsername retrieves user', () => {
  const user = getUserByUsername('admin_user');
  assert.ok(user, 'should find user');
  assert.equal(user.email, 'admin@example.com');
});

await test('createUser with appraiser role', () => {
  const result = createUser({
    username: 'appraiser1',
    display_name: 'Jane Appraiser',
    role: 'appraiser',
  });
  assert.equal(result.role, 'appraiser');
});

await test('listUsers returns users with filters', () => {
  const { users } = listUsers();
  assert.ok(users.length >= 2, 'should have at least 2 users');

  const { users: admins } = listUsers({ role: 'admin' });
  assert.ok(admins.length >= 1, 'should have at least 1 admin');
});

await test('updateUser modifies user fields', () => {
  const result = updateUser(adminUserId, { display_name: 'Super Admin' });
  assert.ok(!result.error, 'should not error');
  const updated = getUser(adminUserId);
  assert.equal(updated.display_name, 'Super Admin');
});

await test('deactivateUser and reactivateUser work', () => {
  const created = createUser({ username: 'deactivate_test', display_name: 'Deactivate Test', role: 'trainee' });
  const dResult = deactivateUser(created.id);
  assert.ok(!dResult.error, 'deactivate should not error');
  const deactivated = getUser(created.id);
  assert.equal(deactivated.status, 'inactive');

  const rResult = reactivateUser(created.id);
  assert.ok(!rResult.error, 'reactivate should not error');
  const reactivated = getUser(created.id);
  assert.equal(reactivated.status, 'active');
});

await test('suspendUser sets suspended status', () => {
  const created = createUser({ username: 'suspend_test', display_name: 'Suspend Test', role: 'reviewer' });
  const result = suspendUser(created.id, 'Policy violation');
  assert.ok(!result.error, 'should not error');
  const suspended = getUser(created.id);
  assert.equal(suspended.status, 'suspended');
});

await test('recordLogin updates login tracking', () => {
  const before = getUser(adminUserId);
  const loginCount = before.login_count || 0;

  recordLogin(adminUserId, '127.0.0.1', 'TestAgent/1.0');
  const after = getUser(adminUserId);
  assert.equal(after.login_count, loginCount + 1);
  assert.ok(after.last_login_at, 'should set last_login_at');
});

await test('getUserPermissions returns role-based permissions', () => {
  const perms = getUserPermissions(adminUserId);
  assert.ok(typeof perms === 'object', 'should return permissions object');
});

// ═══════════════════════════════════════════════════════════════════════════
// Access Control
// ═══════════════════════════════════════════════════════════════════════════

await test('seedDefaultPolicies creates standard policies', () => {
  seedDefaultPolicies();
  const { policies } = listPolicies();
  assert.ok(policies.length >= 1, 'should have policies after seeding');
});

await test('getDefaultPolicies returns built-in role definitions', () => {
  const defaults = getDefaultPolicies();
  assert.ok(Array.isArray(defaults), 'should return array');
  assert.ok(defaults.length > 0, 'should have entries');
  assert.ok(defaults[0].role, 'entries should have role');
});

await test('createPolicy creates custom access policy', () => {
  const policy = createPolicy({
    name: 'Trainee case access',
    role: 'trainee',
    resource_type: 'case',
    actions: ['read', 'write'],
    conditions: { ownCasesOnly: true },
  });
  assert.ok(policy.id.startsWith('apol_'), 'should have apol_ prefix');
});

await test('checkAccess evaluates access rules', () => {
  const result = checkAccess(adminUserId, 'case', 'read', {});
  assert.ok(typeof result === 'object', 'should return result');
  assert.ok('allowed' in result, 'should have allowed property');
});

await test('logAccess records access attempt', () => {
  logAccess({
    user_id: adminUserId,
    username: 'admin_user',
    action: 'read',
    resource_type: 'case',
    resource_id: 'case-123',
    success: true,
  });

  const result = getAccessLog({ limit: 5 });
  assert.ok(result.entries.length >= 1, 'should have access log entries');
});

await test('getAccessStats returns aggregated access data', () => {
  const stats = getAccessStats();
  assert.ok(typeof stats === 'object', 'should return stats');
});

// ═══════════════════════════════════════════════════════════════════════════
// Data Retention
// ═══════════════════════════════════════════════════════════════════════════

await test('seedDefaultRules creates standard retention rules', () => {
  const result = seedDefaultRules();
  assert.ok(result.created >= 0, 'should report created count');
  const { rules } = listRetentionRules();
  assert.ok(rules.length >= 1, 'should have rules after seeding');
});

await test('createRetentionRule creates custom rule', () => {
  const result = createRetentionRule({
    name: 'Test temp cleanup',
    resource_type: 'temp_files',
    retention_days: 7,
    action: 'delete',
  });
  assert.ok(result.id.startsWith('retn_'), 'should have retn_ prefix');
  const rule = getRetentionRule(result.id);
  assert.equal(rule.retention_days, 7);
});

await test('runRetentionCheck returns items due for action', () => {
  const result = runRetentionCheck();
  assert.ok(typeof result === 'object', 'should return check result');
});

await test('getRetentionSummary provides overview', () => {
  const summary = getRetentionSummary();
  assert.ok(typeof summary === 'object', 'should return summary');
});

// ═══════════════════════════════════════════════════════════════════════════
// Compliance
// ═══════════════════════════════════════════════════════════════════════════

await test('createComplianceRecord records compliance check', () => {
  const caseId = 'case-cmpl-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const result = createComplianceRecord({
    case_id: caseId,
    compliance_type: 'uspap',
    status: 'compliant',
    checked_by: 'admin_user',
    findings: [{ item: 'Scope of work', status: 'pass' }],
  });
  assert.ok(result.id.startsWith('cmpl_'), 'should have cmpl_ prefix');
});

await test('getCaseComplianceStatus returns overall status', () => {
  const caseId = 'case-cmpl2-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  createComplianceRecord({ case_id: caseId, compliance_type: 'uspap', status: 'compliant', checked_by: 'admin' });
  createComplianceRecord({ case_id: caseId, compliance_type: 'state_license', status: 'compliant', checked_by: 'admin' });

  const status = getCaseComplianceStatus(caseId);
  assert.ok(typeof status === 'object', 'should return status');
  assert.ok(status.overall, 'should have overall status');
  assert.ok(status.totalChecks >= 2, 'should have at least 2 checks');
});

await test('getComplianceSummary returns system-wide data', () => {
  const summary = getComplianceSummary();
  assert.ok(typeof summary === 'object', 'should return summary');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(40));
console.log(`securityGovernance: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const { label, err } of failures) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${err.stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}
