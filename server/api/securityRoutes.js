/**
 * server/api/securityRoutes.js
 * -------------------------------
 * Phase 15 — Security & Governance REST Endpoints
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   GET    /security/users                       — list users
 *   POST   /security/users                       — create user
 *   GET    /security/users/:userId               — get user
 *   PUT    /security/users/:userId               — update user
 *   POST   /security/users/:userId/deactivate    — deactivate user
 *   POST   /security/users/:userId/suspend       — suspend user
 *   POST   /security/users/:userId/reactivate    — reactivate user
 *
 *   POST   /security/access/check                — check access
 *   GET    /security/policies                    — list policies
 *   POST   /security/policies                    — create policy
 *   PUT    /security/policies/:policyId          — update policy
 *   DELETE /security/policies/:policyId          — delete policy
 *   POST   /security/policies/seed               — seed default policies
 *
 *   GET    /security/access-log                  — query access log
 *   GET    /security/access-log/stats            — access statistics
 *
 *   GET    /security/retention/rules             — list retention rules
 *   POST   /security/retention/rules             — create retention rule
 *   PUT    /security/retention/rules/:ruleId     — update retention rule
 *   POST   /security/retention/check             — run retention check
 *   POST   /security/retention/execute/:ruleId   — execute retention rule
 *   POST   /security/retention/seed              — seed default rules
 *
 *   GET    /cases/:caseId/compliance             — list compliance records
 *   POST   /cases/:caseId/compliance/check       — run compliance check
 *   GET    /cases/:caseId/compliance/status       — overall compliance status
 *   GET    /security/compliance/summary          — system-wide compliance summary
 */

import { Router } from 'express';
import log from '../logger.js';

import {
  createUser,
  getUser,
  getUserByUsername,
  listUsers,
  updateUser,
  deactivateUser,
  suspendUser,
  reactivateUser,
  recordLogin,
  recordFailedLogin,
  getUserPermissions,
} from '../security/userService.js';

import {
  checkAccess,
  createPolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  deletePolicy,
  getDefaultPolicies,
  seedDefaultPolicies,
  logAccess,
  getAccessLog,
  getAccessStats,
} from '../security/accessControlService.js';

import {
  createRetentionRule,
  getRetentionRule,
  listRetentionRules,
  updateRetentionRule,
  deleteRetentionRule,
  runRetentionCheck,
  executeRetentionRule,
  getRetentionSummary,
  seedDefaultRules,
} from '../security/retentionService.js';

import {
  createComplianceRecord,
  getComplianceRecord,
  listComplianceRecords,
  updateComplianceRecord,
  runComplianceCheck,
  getCaseComplianceStatus,
  getComplianceSummary,
} from '../security/complianceService.js';

import { z } from 'zod';
import { parsePayload } from '../utils/routeUtils.js';

const createUserSchema = z.object({
  username: z.string().min(1).max(100),
  email: z.string().max(200).optional(),
  role: z.string().max(40).optional(),
  displayName: z.string().max(200).optional(),
}).passthrough();

const updateUserSchema = z.object({}).passthrough();

const suspendUserSchema = z.object({
  reason: z.string().max(500).optional(),
}).passthrough();

const accessCheckSchema = z.object({
  userId: z.string().min(1).max(80),
  resourceType: z.string().min(1).max(80),
  action: z.string().min(1).max(80),
  context: z.record(z.unknown()).optional(),
}).passthrough();

const createPolicySchema = z.object({
  role: z.string().max(40).optional(),
  resource_type: z.string().max(80).optional(),
  action: z.string().max(80).optional(),
  effect: z.enum(['allow', 'deny']).optional(),
}).passthrough();

const updatePolicySchema = z.object({}).passthrough();

const createRetentionRuleSchema = z.object({
  resource_type: z.string().max(80),
  retention_days: z.number().int().positive().optional(),
}).passthrough();

const updateRetentionRuleSchema = z.object({}).passthrough();

const complianceCheckSchema = z.object({
  complianceType: z.string().min(1).max(80).optional(),
  compliance_type: z.string().min(1).max(80).optional(),
}).passthrough().refine(d => d.complianceType || d.compliance_type, {
  message: 'complianceType is required',
});

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// User Management
// ══════════════════════════════════════════════════════════════════════════════

// GET /security/users — list users
router.get('/security/users', (req, res) => {
  try {
    const opts = {
      role: req.query.role || undefined,
      status: req.query.status || undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
    };
    const result = listUsers(opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:list-users', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/users — create user
router.post('/security/users', (req, res) => {
  try {
    const body = parsePayload(createUserSchema, req.body || {}, res);
    if (!body) return;
    const result = createUser(body);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:create-user', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /security/users/:userId — get user
router.get('/security/users/:userId', (req, res) => {
  try {
    const user = getUser(req.params.userId);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    res.json({ ok: true, user });
  } catch (err) {
    log.error('api:security:get-user', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /security/users/:userId — update user
router.put('/security/users/:userId', (req, res) => {
  try {
    const body = parsePayload(updateUserSchema, req.body || {}, res);
    if (!body) return;
    const result = updateUser(req.params.userId, body);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:update-user', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/users/:userId/deactivate — deactivate user
router.post('/security/users/:userId/deactivate', (req, res) => {
  try {
    const result = deactivateUser(req.params.userId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:deactivate-user', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/users/:userId/suspend — suspend user
router.post('/security/users/:userId/suspend', (req, res) => {
  try {
    const body = parsePayload(suspendUserSchema, req.body || {}, res);
    if (!body) return;
    const result = suspendUser(req.params.userId, body.reason);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:suspend-user', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/users/:userId/reactivate — reactivate user
router.post('/security/users/:userId/reactivate', (req, res) => {
  try {
    const result = reactivateUser(req.params.userId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:reactivate-user', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Access Control
// ══════════════════════════════════════════════════════════════════════════════

// POST /security/access/check — check access
router.post('/security/access/check', (req, res) => {
  try {
    const body = parsePayload(accessCheckSchema, req.body || {}, res);
    if (!body) return;
    const result = checkAccess(body.userId, body.resourceType, body.action, body.context || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:check-access', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /security/policies — list policies
router.get('/security/policies', (req, res) => {
  try {
    const opts = {
      role: req.query.role || undefined,
      resource_type: req.query.resource_type || undefined,
      active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
    };
    const result = listPolicies(opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:list-policies', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/policies/seed — seed default policies (must be before /:policyId)
router.post('/security/policies/seed', (req, res) => {
  try {
    const result = seedDefaultPolicies();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:seed-policies', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/policies — create policy
router.post('/security/policies', (req, res) => {
  try {
    const body = parsePayload(createPolicySchema, req.body || {}, res);
    if (!body) return;
    const result = createPolicy(body);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:create-policy', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /security/policies/:policyId — update policy
router.put('/security/policies/:policyId', (req, res) => {
  try {
    const body = parsePayload(updatePolicySchema, req.body || {}, res);
    if (!body) return;
    const result = updatePolicy(req.params.policyId, body);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:update-policy', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /security/policies/:policyId — delete policy
router.delete('/security/policies/:policyId', (req, res) => {
  try {
    const result = deletePolicy(req.params.policyId);
    if (result.error) return res.status(404).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:delete-policy', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Access Log
// ══════════════════════════════════════════════════════════════════════════════

// GET /security/access-log/stats — access statistics (must be before generic route)
router.get('/security/access-log/stats', (req, res) => {
  try {
    const since = req.query.since || undefined;
    const stats = getAccessStats(since);
    res.json({ ok: true, stats });
  } catch (err) {
    log.error('api:security:access-stats', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /security/access-log — query access log
router.get('/security/access-log', (req, res) => {
  try {
    const opts = {
      userId: req.query.userId || undefined,
      action: req.query.action || undefined,
      resourceType: req.query.resourceType || undefined,
      since: req.query.since || undefined,
      until: req.query.until || undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
    };
    const result = getAccessLog(opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:access-log', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Data Retention
// ══════════════════════════════════════════════════════════════════════════════

// GET /security/retention/rules — list retention rules
router.get('/security/retention/rules', (req, res) => {
  try {
    const opts = {
      resource_type: req.query.resource_type || undefined,
      active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
    };
    const result = listRetentionRules(opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:list-retention', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/retention/rules — create retention rule
router.post('/security/retention/rules', (req, res) => {
  try {
    const body = parsePayload(createRetentionRuleSchema, req.body || {}, res);
    if (!body) return;
    const result = createRetentionRule(body);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:create-retention', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /security/retention/rules/:ruleId — update retention rule
router.put('/security/retention/rules/:ruleId', (req, res) => {
  try {
    const body = parsePayload(updateRetentionRuleSchema, req.body || {}, res);
    if (!body) return;
    const result = updateRetentionRule(req.params.ruleId, body);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:update-retention', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/retention/check — run retention check
router.post('/security/retention/check', (req, res) => {
  try {
    const result = runRetentionCheck();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:retention-check', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/retention/execute/:ruleId — execute retention rule
router.post('/security/retention/execute/:ruleId', (req, res) => {
  try {
    const result = executeRetentionRule(req.params.ruleId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:retention-execute', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /security/retention/seed — seed default rules
router.post('/security/retention/seed', (req, res) => {
  try {
    const result = seedDefaultRules();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:retention-seed', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Compliance
// ══════════════════════════════════════════════════════════════════════════════

// GET /cases/:caseId/compliance — list compliance records for a case
router.get('/cases/:caseId/compliance', (req, res) => {
  try {
    const records = listComplianceRecords(req.params.caseId);
    res.json({ ok: true, records });
  } catch (err) {
    log.error('api:security:list-compliance', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/compliance/check — run compliance check
router.post('/cases/:caseId/compliance/check', (req, res) => {
  try {
    const body = parsePayload(complianceCheckSchema, req.body || {}, res);
    if (!body) return;
    const complianceType = body.complianceType || body.compliance_type;
    const result = runComplianceCheck(req.params.caseId, complianceType);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:compliance-check', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/compliance/status — overall compliance status
router.get('/cases/:caseId/compliance/status', (req, res) => {
  try {
    const result = getCaseComplianceStatus(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:compliance-status', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /security/compliance/summary — system-wide compliance summary
router.get('/security/compliance/summary', (req, res) => {
  try {
    const result = getComplianceSummary();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:compliance-summary', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
