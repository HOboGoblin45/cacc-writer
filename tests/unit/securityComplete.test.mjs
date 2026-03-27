/**
 * tests/unit/securityComplete.test.mjs
 * ----------------------------------------
 * Unit tests for Window 5 — Security, Reliability & Productization:
 *   - Encryption at rest (encrypt/decrypt, key status, rotation)
 *   - Backup & restore (create, list, verify)
 *   - Feature flags (create, enable, disable, check)
 *   - Tenants (create, get, update, deactivate)
 *   - Billing (record event, history, summary)
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-sec-complete-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'sec-complete-test.db');
process.env.CACC_ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests';

const { getDb } = await import('../../server/db/database.js');
getDb();

const {
  encryptField, decryptField, rotateKey, getEncryptionStatus,
  encryptCaseSensitiveFields, decryptCaseSensitiveFields,
} = await import('../../server/security/encryptionService.js');

const {
  createBackup, listBackups, getBackupSchedule, setBackupSchedule,
  verifyBackup, getDRStatus,
} = await import('../../server/security/backupRestoreService.js');

const {
  createTenant, getTenant, getTenantByName, listTenants,
  updateTenant, deactivateTenant, getTenantUsage,
} = await import('../../server/business/tenantService.js');

const {
  createFlag, getFlag, listFlags, isEnabled,
  enableFlag, disableFlag, seedDefaultFlags,
} = await import('../../server/business/featureFlagService.js');

const {
  recordBillingEvent, getBillingHistory, getBillingSummary, getActivePlans,
} = await import('../../server/business/billingService.js');

// ══════════════════════════════════════════════════════════════════════════════
// Encryption Tests
// ══════════════════════════════════════════════════════════════════════════════

await test('Encryption: encrypt/decrypt round trip', () => {
  const plaintext = 'John Doe, 123 Main St';
  const encrypted = encryptField(plaintext);
  assert.ok(encrypted, 'encrypted should not be empty');
  assert.notEqual(encrypted, plaintext, 'encrypted should differ from plaintext');

  // Need to get the default key ID for decryption
  const status = getEncryptionStatus();
  const activeKey = status.keys.find(k => k.status === 'active');
  const decrypted = decryptField(encrypted, activeKey.id);
  assert.equal(decrypted, plaintext, 'decrypted should match original plaintext');
});

await test('Encryption: encrypt returns different ciphertext each time (random IV)', () => {
  const plaintext = 'sensitive data';
  const enc1 = encryptField(plaintext);
  const enc2 = encryptField(plaintext);
  assert.notEqual(enc1, enc2, 'each encryption should produce unique ciphertext due to random IV');
});

await test('Encryption: getEncryptionStatus returns valid status', () => {
  const status = getEncryptionStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.algorithm, 'aes-256-gcm');
  assert.ok(status.keyCount >= 1, 'should have at least one key');
  assert.ok(status.activeKeyCount >= 1, 'should have at least one active key');
  assert.equal(typeof status.rotationDue, 'boolean');
});

await test('Encryption: key rotation creates new key and marks old as rotated', () => {
  const statusBefore = getEncryptionStatus();
  const oldKeyId = statusBefore.keys.find(k => k.status === 'active').id;

  const result = rotateKey(oldKeyId);
  assert.ok(result.newKeyId, 'should return new key ID');
  assert.equal(result.oldKeyId, oldKeyId);

  const statusAfter = getEncryptionStatus();
  const rotatedKey = statusAfter.keys.find(k => k.id === oldKeyId);
  assert.equal(rotatedKey.status, 'rotated', 'old key should be marked as rotated');
});

// ══════════════════════════════════════════════════════════════════════════════
// Backup Tests
// ══════════════════════════════════════════════════════════════════════════════

await test('Backup: getBackupSchedule returns default schedule', () => {
  const schedule = getBackupSchedule();
  assert.ok(schedule, 'schedule should exist');
  assert.equal(schedule.intervalHours, 24);
  assert.equal(schedule.retentionDays, 30);
  assert.equal(schedule.maxBackups, 10);
  assert.equal(schedule.enabled, true);
});

await test('Backup: setBackupSchedule updates configuration', () => {
  const updated = setBackupSchedule({ intervalHours: 12, retentionDays: 60 });
  assert.equal(updated.intervalHours, 12);
  assert.equal(updated.retentionDays, 60);
});

await test('Backup: listBackups returns array', () => {
  const backups = listBackups();
  assert.ok(Array.isArray(backups), 'backups should be an array');
});

await test('Backup: getDRStatus returns readiness check', () => {
  const status = getDRStatus();
  assert.equal(typeof status.ready, 'boolean');
  assert.equal(typeof status.totalBackups, 'number');
  assert.equal(typeof status.scheduleEnabled, 'boolean');
  assert.ok(Array.isArray(status.recommendations));
});

// ══════════════════════════════════════════════════════════════════════════════
// Feature Flag Tests
// ══════════════════════════════════════════════════════════════════════════════

await test('Feature flags: create and get flag', () => {
  const result = createFlag({ flagKey: 'test_feature', description: 'Test feature', enabled: false });
  assert.ok(result.flag, 'should return created flag');
  assert.equal(result.flag.flagKey, 'test_feature');
  assert.equal(result.flag.enabled, false);

  const fetched = getFlag('test_feature');
  assert.ok(fetched, 'should find flag by key');
  assert.equal(fetched.flagKey, 'test_feature');
});

await test('Feature flags: enable and disable', () => {
  const enabled = enableFlag('test_feature');
  assert.ok(enabled.flag, 'should return updated flag');
  assert.equal(enabled.flag.enabled, true);
  assert.ok(isEnabled('test_feature'), 'isEnabled should return true');

  const disabled = disableFlag('test_feature');
  assert.equal(disabled.flag.enabled, false);
  assert.ok(!isEnabled('test_feature'), 'isEnabled should return false after disable');
});

await test('Feature flags: isEnabled returns false for nonexistent flag', () => {
  assert.equal(isEnabled('nonexistent_flag'), false);
});

await test('Feature flags: seedDefaultFlags creates defaults', () => {
  const result = seedDefaultFlags();
  assert.ok(result.created >= 1, 'should create at least one flag');
  assert.ok(result.total >= 1, 'should report total defaults');

  // Seeding again should skip existing
  const result2 = seedDefaultFlags();
  assert.equal(result2.created, 0, 'second seed should create zero new flags');
  assert.ok(result2.skipped >= 1, 'should skip existing flags');
});

await test('Feature flags: listFlags returns all flags', () => {
  const flags = listFlags();
  assert.ok(Array.isArray(flags));
  assert.ok(flags.length >= 1, 'should have at least one flag');
});

// ══════════════════════════════════════════════════════════════════════════════
// Tenant Tests
// ══════════════════════════════════════════════════════════════════════════════

await test('Tenant: create and get tenant', () => {
  const result = createTenant({ tenantName: 'acme-appraisals', displayName: 'Acme Appraisals' });
  assert.ok(result.tenant, 'should return created tenant');
  assert.equal(result.tenant.tenantName, 'acme-appraisals');
  assert.equal(result.tenant.status, 'active');

  const fetched = getTenant(result.tenant.id);
  assert.ok(fetched, 'should find tenant by ID');
  assert.equal(fetched.tenantName, 'acme-appraisals');
});

await test('Tenant: get by name', () => {
  const tenant = getTenantByName('acme-appraisals');
  assert.ok(tenant, 'should find by name');
  assert.equal(tenant.displayName, 'Acme Appraisals');
});

await test('Tenant: update tenant', () => {
  const tenant = getTenantByName('acme-appraisals');
  const result = updateTenant(tenant.id, { displayName: 'Acme Updated', maxUsers: 50 });
  assert.ok(result.tenant);
  assert.equal(result.tenant.displayName, 'Acme Updated');
  assert.equal(result.tenant.maxUsers, 50);
});

await test('Tenant: deactivate tenant', () => {
  const tenant = getTenantByName('acme-appraisals');
  const result = deactivateTenant(tenant.id);
  assert.ok(result.tenant);
  assert.equal(result.tenant.status, 'inactive');
});

await test('Tenant: listTenants returns array', () => {
  const tenants = listTenants();
  assert.ok(Array.isArray(tenants));
  assert.ok(tenants.length >= 1);
});

await test('Tenant: duplicate name returns error', () => {
  createTenant({ tenantName: 'unique-tenant' });
  const dup = createTenant({ tenantName: 'unique-tenant' });
  assert.ok(dup.error, 'duplicate tenant name should return error');
});

// ══════════════════════════════════════════════════════════════════════════════
// Billing Tests
// ══════════════════════════════════════════════════════════════════════════════

await test('Billing: record event and get history', () => {
  const tenant = getTenantByName('acme-appraisals');
  const result = recordBillingEvent({
    tenantId: tenant.id,
    eventType: 'subscription',
    amount: 99.00,
    description: 'Monthly subscription',
  });
  assert.ok(result.event, 'should return recorded event');
  assert.equal(result.event.eventType, 'subscription');
  assert.equal(result.event.amount, 99);

  const history = getBillingHistory(tenant.id);
  assert.ok(Array.isArray(history));
  assert.ok(history.length >= 1);
});

await test('Billing: get summary', () => {
  const tenant = getTenantByName('acme-appraisals');
  const summary = getBillingSummary(tenant.id, 'month');
  assert.ok(summary, 'summary should exist');
  assert.equal(typeof summary.totalAmount, 'number');
  assert.equal(typeof summary.totalEvents, 'number');
  assert.ok(summary.totalEvents >= 1);
});

await test('Billing: getActivePlans returns plan list', () => {
  const plans = getActivePlans();
  assert.ok(Array.isArray(plans));
  assert.ok(plans.length >= 2);
  assert.ok(plans.some(p => p.id === 'standard'));
  assert.ok(plans.some(p => p.id === 'enterprise'));
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Failures:');
  for (const { label, err } of failures) {
    console.log(`    - ${label}: ${err.message}`);
  }
}

// Cleanup
try {
  const { closeDb } = await import('../../server/db/database.js');
  closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch { /* best effort */ }

if (failed > 0) process.exit(1);
