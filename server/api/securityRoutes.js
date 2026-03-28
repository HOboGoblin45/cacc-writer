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

import {
  encryptField,
  decryptField,
  rotateKey,
  getEncryptionStatus,
  encryptCaseSensitiveFields,
  decryptCaseSensitiveFields,
} from '../security/encryptionService.js';

import {
  createBackup,
  listBackups,
  restoreFromBackup,
  getBackupSchedule,
  setBackupSchedule,
  verifyBackup,
  getDRStatus,
} from '../security/backupRestoreService.js';

import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';
import { sendErrorResponse } from '../utils/errorResponse.js';

// ══════════════════════════════════════════════════════════════════════════════
// Zod Schemas
// ══════════════════════════════════════════════════════════════════════════════

// User Management Schemas
const createUserSchema = z.object({
  username: z.string().min(1).max(100),
  email: z.string().email().max(200).optional(),
  role: z.string().max(40).optional(),
  displayName: z.string().max(200).optional(),
}).passthrough();

const updateUserSchema = z.object({}).passthrough();

const userIdParamSchema = z.object({
  userId: z.string().min(1),
});

const suspendUserSchema = z.object({
  reason: z.string().max(500).optional(),
}).passthrough();

const listUsersQuerySchema = z.object({
  role: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
}).passthrough();

// Access Control Schemas
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

const policyIdParamSchema = z.object({
  policyId: z.string().min(1),
});

const listPoliciesQuerySchema = z.object({
  role: z.string().optional(),
  resource_type: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
}).passthrough();

// Access Log Schemas
const listAccessLogQuerySchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
}).passthrough();

const accessStatsQuerySchema = z.object({
  since: z.string().optional(),
}).passthrough();

// Retention Rules Schemas
const createRetentionRuleSchema = z.object({
  resource_type: z.string().max(80),
  retention_days: z.number().int().positive().optional(),
}).passthrough();

const updateRetentionRuleSchema = z.object({}).passthrough();

const ruleIdParamSchema = z.object({
  ruleId: z.string().min(1),
});

const listRetentionRulesQuerySchema = z.object({
  resource_type: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
}).passthrough();

// Compliance Schemas
const caseIdParamSchema = z.object({
  caseId: z.string().min(1),
});

const complianceCheckSchema = z.object({
  complianceType: z.string().min(1).max(80).optional(),
  compliance_type: z.string().min(1).max(80).optional(),
}).passthrough().refine(d => d.complianceType || d.compliance_type, {
  message: 'complianceType is required',
});

// Encryption Schemas
const rotateKeySchema = z.object({
  oldKeyId: z.string().optional(),
  newKeyId: z.string().optional(),
}).passthrough();

// Backup Schemas
const backupIdParamSchema = z.object({
  backupId: z.string().min(1),
});

const createBackupSchema = z.object({}).passthrough();

const setBackupScheduleSchema = z.object({}).passthrough();

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// User Management
// ══════════════════════════════════════════════════════════════════════════════

// GET /security/users — list users
router.get('/security/users', validateQuery(listUsersQuerySchema), (req, res) => {
  try {
    const opts = {
      role: req.validatedQuery.role || undefined,
      status: req.validatedQuery.status || undefined,
      limit: req.validatedQuery.limit || undefined,
      offset: req.validatedQuery.offset || undefined,
    };
    const result = listUsers(opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:list-users', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/users — create user
router.post('/security/users', validateBody(createUserSchema), (req, res) => {
  try {
    const result = createUser(req.validated);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:create-user', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /security/users/:userId — get user
router.get('/security/users/:userId', validateParams(userIdParamSchema), (req, res) => {
  try {
    const user = getUser(req.validatedParams.userId);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    res.json({ ok: true, user });
  } catch (err) {
    log.error('api:security:get-user', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// PUT /security/users/:userId — update user
router.put('/security/users/:userId', validateParams(userIdParamSchema), validateBody(updateUserSchema), (req, res) => {
  try {
    const result = updateUser(req.validatedParams.userId, req.validated);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:update-user', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/users/:userId/deactivate — deactivate user
router.post('/security/users/:userId/deactivate', validateParams(userIdParamSchema), (req, res) => {
  try {
    const result = deactivateUser(req.validatedParams.userId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:deactivate-user', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/users/:userId/suspend — suspend user
router.post('/security/users/:userId/suspend', validateParams(userIdParamSchema), validateBody(suspendUserSchema), (req, res) => {
  try {
    const result = suspendUser(req.validatedParams.userId, req.validated.reason);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:suspend-user', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/users/:userId/reactivate — reactivate user
router.post('/security/users/:userId/reactivate', validateParams(userIdParamSchema), (req, res) => {
  try {
    const result = reactivateUser(req.validatedParams.userId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:reactivate-user', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Access Control
// ══════════════════════════════════════════════════════════════════════════════

// POST /security/access/check — check access
router.post('/security/access/check', validateBody(accessCheckSchema), (req, res) => {
  try {
    const result = checkAccess(req.validated.userId, req.validated.resourceType, req.validated.action, req.validated.context || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:check-access', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /security/policies — list policies
router.get('/security/policies', validateQuery(listPoliciesQuerySchema), (req, res) => {
  try {
    const opts = {
      role: req.validatedQuery.role || undefined,
      resource_type: req.validatedQuery.resource_type || undefined,
      active: req.validatedQuery.active !== undefined ? req.validatedQuery.active === 'true' : undefined,
      limit: req.validatedQuery.limit || undefined,
      offset: req.validatedQuery.offset || undefined,
    };
    const result = listPolicies(opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:list-policies', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/policies/seed — seed default policies (must be before /:policyId)
router.post('/security/policies/seed', (req, res) => {
  try {
    const result = seedDefaultPolicies();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:seed-policies', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/policies — create policy
router.post('/security/policies', validateBody(createPolicySchema), (req, res) => {
  try {
    const result = createPolicy(req.validated);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:create-policy', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// PUT /security/policies/:policyId — update policy
router.put('/security/policies/:policyId', validateParams(policyIdParamSchema), validateBody(updatePolicySchema), (req, res) => {
  try {
    const result = updatePolicy(req.validatedParams.policyId, req.validated);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:update-policy', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// DELETE /security/policies/:policyId — delete policy
router.delete('/security/policies/:policyId', validateParams(policyIdParamSchema), (req, res) => {
  try {
    const result = deletePolicy(req.validatedParams.policyId);
    if (result.error) return res.status(404).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:delete-policy', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Access Log
// ══════════════════════════════════════════════════════════════════════════════

// GET /security/access-log/stats — access statistics (must be before generic route)
router.get('/security/access-log/stats', validateQuery(accessStatsQuerySchema), (req, res) => {
  try {
    const stats = getAccessStats(req.validatedQuery.since || undefined);
    res.json({ ok: true, stats });
  } catch (err) {
    log.error('api:security:access-stats', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /security/access-log — query access log
router.get('/security/access-log', validateQuery(listAccessLogQuerySchema), (req, res) => {
  try {
    const opts = {
      userId: req.validatedQuery.userId || undefined,
      action: req.validatedQuery.action || undefined,
      resourceType: req.validatedQuery.resourceType || undefined,
      since: req.validatedQuery.since || undefined,
      until: req.validatedQuery.until || undefined,
      limit: req.validatedQuery.limit || undefined,
      offset: req.validatedQuery.offset || undefined,
    };
    const result = getAccessLog(opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:access-log', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Data Retention
// ══════════════════════════════════════════════════════════════════════════════

// GET /security/retention/rules — list retention rules
router.get('/security/retention/rules', validateQuery(listRetentionRulesQuerySchema), (req, res) => {
  try {
    const opts = {
      resource_type: req.validatedQuery.resource_type || undefined,
      active: req.validatedQuery.active !== undefined ? req.validatedQuery.active === 'true' : undefined,
      limit: req.validatedQuery.limit || undefined,
      offset: req.validatedQuery.offset || undefined,
    };
    const result = listRetentionRules(opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:list-retention', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/retention/rules — create retention rule
router.post('/security/retention/rules', validateBody(createRetentionRuleSchema), (req, res) => {
  try {
    const result = createRetentionRule(req.validated);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:create-retention', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// PUT /security/retention/rules/:ruleId — update retention rule
router.put('/security/retention/rules/:ruleId', validateParams(ruleIdParamSchema), validateBody(updateRetentionRuleSchema), (req, res) => {
  try {
    const result = updateRetentionRule(req.validatedParams.ruleId, req.validated);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:update-retention', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/retention/check — run retention check
router.post('/security/retention/check', (req, res) => {
  try {
    const result = runRetentionCheck();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:retention-check', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/retention/execute/:ruleId — execute retention rule
router.post('/security/retention/execute/:ruleId', validateParams(ruleIdParamSchema), (req, res) => {
  try {
    const result = executeRetentionRule(req.validatedParams.ruleId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:retention-execute', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/retention/seed — seed default rules
router.post('/security/retention/seed', (req, res) => {
  try {
    const result = seedDefaultRules();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:retention-seed', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Compliance
// ══════════════════════════════════════════════════════════════════════════════

// GET /cases/:caseId/compliance — list compliance records for a case
router.get('/cases/:caseId/compliance', validateParams(caseIdParamSchema), (req, res) => {
  try {
    const records = listComplianceRecords(req.validatedParams.caseId);
    res.json({ ok: true, records });
  } catch (err) {
    log.error('api:security:list-compliance', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /cases/:caseId/compliance/check — run compliance check
router.post('/cases/:caseId/compliance/check', validateParams(caseIdParamSchema), validateBody(complianceCheckSchema), (req, res) => {
  try {
    const complianceType = req.validated.complianceType || req.validated.compliance_type;
    const result = runComplianceCheck(req.validatedParams.caseId, complianceType);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:compliance-check', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/compliance/status — overall compliance status
router.get('/cases/:caseId/compliance/status', validateParams(caseIdParamSchema), (req, res) => {
  try {
    const result = getCaseComplianceStatus(req.validatedParams.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:compliance-status', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /security/compliance/summary — system-wide compliance summary
router.get('/security/compliance/summary', (req, res) => {
  try {
    const result = getComplianceSummary();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:compliance-summary', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Encryption
// ══════════════════════════════════════════════════════════════════════════════

// GET /security/encryption/status — encryption status
router.get('/security/encryption/status', (_req, res) => {
  try {
    const status = getEncryptionStatus();
    res.json({ ok: true, status });
  } catch (err) {
    log.error('api:security:encryption-status', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/encryption/encrypt-case/:caseId — encrypt case PII
router.post('/security/encryption/encrypt-case/:caseId', validateParams(caseIdParamSchema), (req, res) => {
  try {
    const result = encryptCaseSensitiveFields(req.validatedParams.caseId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:encrypt-case', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/encryption/rotate-key — rotate encryption key
router.post('/security/encryption/rotate-key', validateBody(rotateKeySchema), (req, res) => {
  try {
    const result = rotateKey(req.validated.oldKeyId, req.validated.newKeyId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:rotate-key', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Backup & Restore
// ══════════════════════════════════════════════════════════════════════════════

// GET /security/backups — list backups
router.get('/security/backups', (_req, res) => {
  try {
    const backups = listBackups();
    res.json({ ok: true, backups });
  } catch (err) {
    log.error('api:security:list-backups', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /security/backups/schedule — get backup schedule (before :backupId)
router.get('/security/backups/schedule', (_req, res) => {
  try {
    const schedule = getBackupSchedule();
    res.json({ ok: true, schedule });
  } catch (err) {
    log.error('api:security:backup-schedule', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// PUT /security/backups/schedule — set backup schedule
router.put('/security/backups/schedule', validateBody(setBackupScheduleSchema), (req, res) => {
  try {
    const schedule = setBackupSchedule(req.validated || {});
    res.json({ ok: true, schedule });
  } catch (err) {
    log.error('api:security:set-backup-schedule', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/backups/create — create backup
router.post('/security/backups/create', validateBody(createBackupSchema), async (req, res) => {
  try {
    const result = await createBackup(req.validated || {});
    if (result.error) return res.status(500).json({ ok: false, error: result.error });
    res.json({ ok: true, backup: result });
  } catch (err) {
    log.error('api:security:create-backup', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/backups/:backupId/verify — verify backup
router.post('/security/backups/:backupId/verify', validateParams(backupIdParamSchema), (req, res) => {
  try {
    const result = verifyBackup(req.validatedParams.backupId);
    if (result.error) return res.status(404).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:verify-backup', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /security/backups/:backupId/restore — restore from backup
router.post('/security/backups/:backupId/restore', validateParams(backupIdParamSchema), (req, res) => {
  try {
    const result = restoreFromBackup(req.validatedParams.backupId);
    if (result.notImplemented) return res.status(501).json({ ok: false, error: result.error, status: result.status });
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:security:restore-backup', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /security/dr-status — disaster recovery readiness
router.get('/security/dr-status', (_req, res) => {
  try {
    const status = getDRStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    log.error('api:security:dr-status', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

export default router;
