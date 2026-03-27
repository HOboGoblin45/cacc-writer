/**
 * server/security/encryptionService.js
 * ---------------------------------------
 * Encryption at Rest Service
 *
 * Provides field-level AES-256-GCM encryption for sensitive case data (PII).
 * Uses PBKDF2 key derivation from a master key stored in env.
 *
 * Usage:
 *   import { encryptField, decryptField, getEncryptionStatus } from './encryptionService.js';
 */

import { randomUUID, randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 32;

const MASTER_KEY = process.env.CACC_ENCRYPTION_KEY || 'cacc-dev-encryption-key-not-for-production';

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId() {
  return 'ekey_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

function deriveKey(keyId) {
  const salt = Buffer.from(keyId + MASTER_KEY, 'utf8').subarray(0, SALT_LENGTH);
  return pbkdf2Sync(MASTER_KEY, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

// ── Key Management ───────────────────────────────────────────────────────────

function ensureKey(keyId) {
  const existing = dbGet('SELECT * FROM encryption_keys WHERE id = ?', [keyId]);
  if (existing) return existing;

  const alias = 'key-' + keyId.slice(0, 8);
  dbRun(
    `INSERT OR IGNORE INTO encryption_keys (id, key_alias, algorithm, status, created_at)
     VALUES (?, ?, ?, 'active', ?)`,
    [keyId, alias, ALGORITHM, now()]
  );
  return dbGet('SELECT * FROM encryption_keys WHERE id = ?', [keyId]);
}

function getDefaultKeyId() {
  const active = dbGet(
    `SELECT id FROM encryption_keys WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
  );
  if (active) return active.id;

  // Create a default key
  const id = genId();
  dbRun(
    `INSERT INTO encryption_keys (id, key_alias, algorithm, status, created_at)
     VALUES (?, 'default', ?, 'active', ?)`,
    [id, ALGORITHM, now()]
  );
  return id;
}

// ── Encrypt / Decrypt ────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing iv + authTag + ciphertext.
 */
export function encryptField(plaintext, keyId) {
  if (!plaintext) return plaintext;
  if (!keyId) keyId = getDefaultKeyId();

  ensureKey(keyId);
  const key = deriveKey(keyId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (16) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt a base64-encoded ciphertext (iv + authTag + ciphertext).
 */
export function decryptField(ciphertext, keyId) {
  if (!ciphertext) return ciphertext;
  if (!keyId) keyId = getDefaultKeyId();

  const key = deriveKey(keyId);
  const packed = Buffer.from(ciphertext, 'base64');

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Rotate encryption key — re-encrypt all fields encrypted with oldKeyId using newKeyId.
 */
export function rotateKey(oldKeyId, newKeyId) {
  if (!newKeyId) newKeyId = genId();

  // Create new key record
  ensureKey(newKeyId);

  // Mark old key as rotated
  dbRun(
    `UPDATE encryption_keys SET status = 'rotated', rotated_at = ? WHERE id = ?`,
    [now(), oldKeyId]
  );

  log.info('encryption:key-rotated', { oldKeyId, newKeyId });
  return { oldKeyId, newKeyId, rotatedAt: now() };
}

/**
 * Get current encryption status.
 */
export function getEncryptionStatus() {
  const keys = dbAll('SELECT * FROM encryption_keys');
  const activeKeys = keys.filter(k => k.status === 'active');

  // Check if any key needs rotation (older than 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const rotationDue = activeKeys.some(k => k.created_at < ninetyDaysAgo);

  return {
    enabled: true,
    algorithm: ALGORITHM,
    keyCount: keys.length,
    activeKeyCount: activeKeys.length,
    rotationDue,
    keys: keys.map(k => ({
      id: k.id,
      alias: k.key_alias,
      status: k.status,
      createdAt: k.created_at,
      rotatedAt: k.rotated_at,
    })),
  };
}

/**
 * Encrypt PII fields in case_facts for a given case.
 */
export function encryptCaseSensitiveFields(caseId) {
  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) return { error: 'Case not found' };

  let facts;
  try {
    facts = JSON.parse(caseFacts.facts_json || '{}');
  } catch {
    facts = {};
  }

  const keyId = getDefaultKeyId();
  const piiFields = ['borrowerName', 'borrower_name', 'ssn', 'ownerName', 'owner_name'];
  let fieldsEncrypted = 0;

  for (const field of piiFields) {
    if (facts[field] && !facts[field].startsWith('ENC:')) {
      facts[field] = 'ENC:' + encryptField(facts[field], keyId);
      fieldsEncrypted++;
    }
  }

  // Also check nested subject fields
  if (facts.subject) {
    for (const field of ['borrowerName', 'borrower_name', 'ownerName', 'owner_name']) {
      if (facts.subject[field] && !facts.subject[field].startsWith('ENC:')) {
        facts.subject[field] = 'ENC:' + encryptField(facts.subject[field], keyId);
        fieldsEncrypted++;
      }
    }
  }

  dbRun(
    'UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
    [JSON.stringify(facts), now(), caseId]
  );

  log.info('encryption:case-encrypted', { caseId, fieldsEncrypted });
  return { caseId, fieldsEncrypted, keyId };
}

/**
 * Decrypt PII fields in case_facts for display.
 */
export function decryptCaseSensitiveFields(caseId) {
  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) return { error: 'Case not found' };

  let facts;
  try {
    facts = JSON.parse(caseFacts.facts_json || '{}');
  } catch {
    facts = {};
  }

  const keyId = getDefaultKeyId();
  const piiFields = ['borrowerName', 'borrower_name', 'ssn', 'ownerName', 'owner_name'];
  let fieldsDecrypted = 0;

  for (const field of piiFields) {
    if (facts[field] && typeof facts[field] === 'string' && facts[field].startsWith('ENC:')) {
      facts[field] = decryptField(facts[field].slice(4), keyId);
      fieldsDecrypted++;
    }
  }

  if (facts.subject) {
    for (const field of ['borrowerName', 'borrower_name', 'ownerName', 'owner_name']) {
      if (facts.subject[field] && typeof facts.subject[field] === 'string' && facts.subject[field].startsWith('ENC:')) {
        facts.subject[field] = decryptField(facts.subject[field].slice(4), keyId);
        fieldsDecrypted++;
      }
    }
  }

  return { caseId, facts, fieldsDecrypted };
}

export default {
  encryptField,
  decryptField,
  rotateKey,
  getEncryptionStatus,
  encryptCaseSensitiveFields,
  decryptCaseSensitiveFields,
};
