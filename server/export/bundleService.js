/**
 * server/export/bundleService.js
 * --------------------------------
 * Export bundling and delivery management service.
 *
 * Handles export job tracking, delivery records, and template management.
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { emitCaseEvent, emitAuditEvent } from '../operations/auditLogger.js';
import log from '../logger.js';

// ── ID helpers ──────────────────────────────────────────────────────────────

function makeJobId() { return 'expj_' + randomUUID().slice(0, 12); }
function makeDeliveryId() { return 'dlvr_' + randomUUID().slice(0, 12); }
function makeTemplateId() { return 'tmpl_' + randomUUID().slice(0, 12); }

// ── JSON helpers ────────────────────────────────────────────────────────────

function parseJson(str, fallback = null) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function stringifyJson(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function hydrateJob(row) {
  if (!row) return null;
  return {
    ...row,
    options: parseJson(row.options_json, {}),
    include_photos: !!row.include_photos,
    include_addenda: !!row.include_addenda,
    include_maps: !!row.include_maps,
    include_sketches: !!row.include_sketches,
  };
}

function hydrateDelivery(row) {
  if (!row) return null;
  return { ...row };
}

function hydrateTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    config: parseJson(row.config_json, {}),
    is_default: !!row.is_default,
    active: !!row.active,
  };
}

// ── Export Jobs ──────────────────────────────────────────────────────────────

export function createExportJob(caseId, data) {
  const db = getDb();
  const id = makeJobId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO export_jobs (id, case_id, export_type, export_status, output_format,
      include_photos, include_addenda, include_maps, include_sketches,
      watermark, recipient_name, recipient_email, delivery_method,
      options_json, created_at)
    VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, caseId, data.exportType, data.outputFormat || null,
    data.includePhotos !== false ? 1 : 0,
    data.includeAddenda !== false ? 1 : 0,
    data.includeMaps !== false ? 1 : 0,
    data.includeSketches !== false ? 1 : 0,
    data.watermark || 'none',
    data.recipientName || null, data.recipientEmail || null,
    data.deliveryMethod || 'download',
    stringifyJson(data.options || {}), now,
  );

  try {
    emitCaseEvent(caseId, 'export.job_created', `Export job created: ${data.exportType}`, {
      jobId: id, exportType: data.exportType,
    });
  } catch { /* non-fatal */ }

  return getExportJob(id);
}

export function getExportJob(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(id);
  return hydrateJob(row);
}

export function listExportJobs(caseId, opts = {}) {
  const db = getDb();
  const clauses = ['case_id = ?'];
  const params = [caseId];

  if (opts.exportType) { clauses.push('export_type = ?'); params.push(opts.exportType); }
  if (opts.status) { clauses.push('export_status = ?'); params.push(opts.status); }

  const limit = Math.min(opts.limit || 50, 200);
  const offset = opts.offset || 0;

  const sql = `SELECT * FROM export_jobs WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.prepare(sql).all(...params).map(hydrateJob);
}

export function updateExportJob(id, updates) {
  const db = getDb();
  const allowed = ['export_status', 'file_path', 'file_name', 'file_size', 'page_count',
    'error_message', 'started_at', 'completed_at', 'duration_ms',
    'delivery_status', 'delivered_at'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(updates[key]);
    }
  }
  if (sets.length === 0) return getExportJob(id);

  params.push(id);
  db.prepare(`UPDATE export_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getExportJob(id);
}

export function cancelExportJob(id) {
  const job = getExportJob(id);
  if (!job) throw new Error(`Export job not found: ${id}`);
  if (!['queued', 'processing'].includes(job.export_status)) {
    throw new Error(`Cannot cancel job in status: ${job.export_status}`);
  }
  return updateExportJob(id, { export_status: 'cancelled' });
}

// ── Bundle Creation ─────────────────────────────────────────────────────────

export function createBundle(caseId, options = {}) {
  const exportTypes = options.exportTypes || ['pdf'];
  const jobs = [];

  for (const type of exportTypes) {
    const job = createExportJob(caseId, {
      exportType: type,
      outputFormat: options.outputFormat,
      watermark: options.watermark || 'final',
      includePhotos: options.includePhotos,
      includeAddenda: options.includeAddenda,
      includeMaps: options.includeMaps,
      includeSketches: options.includeSketches,
      recipientName: options.recipientName,
      recipientEmail: options.recipientEmail,
      deliveryMethod: options.deliveryMethod || 'download',
      options: options.options,
    });
    jobs.push(job);
  }

  try {
    emitCaseEvent(caseId, 'export.bundle_created', `Export bundle created with ${exportTypes.length} type(s)`, {
      types: exportTypes, jobIds: jobs.map(j => j.id),
    });
  } catch { /* non-fatal */ }

  return { caseId, jobs, exportTypes };
}

export function getBundleContents(caseId) {
  return listExportJobs(caseId, { limit: 100 });
}

// ── Delivery Records ────────────────────────────────────────────────────────

export function createDeliveryRecord(exportJobId, data) {
  const db = getDb();
  const id = makeDeliveryId();
  const now = new Date().toISOString();
  const job = getExportJob(exportJobId);
  if (!job) throw new Error(`Export job not found: ${exportJobId}`);

  db.prepare(`
    INSERT INTO delivery_records (id, export_job_id, case_id, delivery_method,
      recipient_name, recipient_email, portal_name, tracking_number,
      delivery_status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id, exportJobId, job.case_id, data.deliveryMethod,
    data.recipientName || null, data.recipientEmail || null,
    data.portalName || null, data.trackingNumber || null,
    data.notes || null, now,
  );

  return getDeliveryRecord(id);
}

export function getDeliveryRecord(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM delivery_records WHERE id = ?').get(id);
  return hydrateDelivery(row);
}

export function listDeliveries(caseId) {
  const db = getDb();
  return db.prepare('SELECT * FROM delivery_records WHERE case_id = ? ORDER BY created_at DESC')
    .all(caseId).map(hydrateDelivery);
}

export function confirmDelivery(deliveryId, method = 'manual') {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE delivery_records SET delivery_status = 'confirmed',
      confirmed_at = ?, confirmation_method = ?
    WHERE id = ?
  `).run(now, method, deliveryId);

  const delivery = getDeliveryRecord(deliveryId);
  if (delivery) {
    try {
      emitCaseEvent(delivery.case_id, 'export.delivery_confirmed', 'Delivery confirmed', {
        deliveryId, method,
      });
    } catch { /* non-fatal */ }
  }
  return delivery;
}

export function updateDeliveryStatus(deliveryId, status, detail = {}) {
  const db = getDb();
  const sets = ['delivery_status = ?'];
  const params = [status];

  if (detail.sentAt) { sets.push('sent_at = ?'); params.push(detail.sentAt); }
  if (detail.deliveredAt) { sets.push('delivered_at = ?'); params.push(detail.deliveredAt); }
  if (detail.errorMessage) { sets.push('error_message = ?'); params.push(detail.errorMessage); }

  params.push(deliveryId);
  db.prepare(`UPDATE delivery_records SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getDeliveryRecord(deliveryId);
}

// ── Export Summary ──────────────────────────────────────────────────────────

export function getExportSummary(caseId) {
  const db = getDb();
  const jobs = listExportJobs(caseId, { limit: 200 });
  const deliveries = listDeliveries(caseId);

  const byType = {};
  const byStatus = {};
  for (const job of jobs) {
    byType[job.export_type] = (byType[job.export_type] || 0) + 1;
    byStatus[job.export_status] = (byStatus[job.export_status] || 0) + 1;
  }

  return {
    caseId,
    totalJobs: jobs.length,
    byType,
    byStatus,
    totalDeliveries: deliveries.length,
    confirmedDeliveries: deliveries.filter(d => d.delivery_status === 'confirmed').length,
    latestJob: jobs[0] || null,
    latestDelivery: deliveries[0] || null,
  };
}

// ── Templates ───────────────────────────────────────────────────────────────

export function getTemplate(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM export_templates WHERE id = ?').get(id);
  return hydrateTemplate(row);
}

export function listTemplates(opts = {}) {
  const db = getDb();
  const clauses = [];
  const params = [];

  if (opts.exportType) { clauses.push('export_type = ?'); params.push(opts.exportType); }
  if (opts.formType) { clauses.push('form_type = ?'); params.push(opts.formType); }
  if (opts.active !== undefined) { clauses.push('active = ?'); params.push(opts.active ? 1 : 0); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM export_templates ${where} ORDER BY created_at DESC`)
    .all(...params).map(hydrateTemplate);
}

export function createTemplate(data) {
  const db = getDb();
  const id = makeTemplateId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO export_templates (id, name, export_type, form_type, description,
      config_json, is_default, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id, data.name, data.exportType, data.formType || null,
    data.description || null, stringifyJson(data.config || {}),
    data.isDefault ? 1 : 0, now,
  );

  return getTemplate(id);
}

export function updateTemplate(id, updates) {
  const db = getDb();
  const allowed = ['name', 'description', 'form_type', 'is_default', 'active'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(typeof updates[key] === 'boolean' ? (updates[key] ? 1 : 0) : updates[key]);
    }
  }
  if (updates.config) {
    sets.push('config_json = ?');
    params.push(stringifyJson(updates.config));
  }
  if (sets.length === 0) return getTemplate(id);

  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE export_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getTemplate(id);
}
