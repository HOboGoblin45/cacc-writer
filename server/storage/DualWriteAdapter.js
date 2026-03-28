/**
 * server/storage/DualWriteAdapter.js
 * ==================================
 * Dual-write storage adapter for zero-downtime cloud migration.
 *
 * Writes to both primary and secondary storage simultaneously:
 * - Primary: Authoritative source (new cloud storage)
 * - Secondary: Fallback source (legacy local filesystem)
 *
 * On read:
 * 1. Read from primary (fast, preferred)
 * 2. If not found, fallback to secondary
 * 3. Backfill to primary (async, best effort)
 *
 * Use case: Migrate from local filesystem to S3/R2 without downtime.
 *
 * Configuration:
 * ```
 * STORAGE_PROVIDER=dual
 * STORAGE_PRIMARY_PROVIDER=r2          # New cloud storage
 * STORAGE_SECONDARY_PROVIDER=local     # Legacy filesystem
 * ```
 *
 * @example
 * const primary = new R2StorageAdapter(config);
 * const secondary = new LocalStorageAdapter({ basePath: './data' });
 * const storage = new DualWriteAdapter(primary, secondary);
 *
 * // Writes to both; reads from primary first, then secondary
 * await storage.put('exports/case.pdf', buffer);
 * const data = await storage.get('exports/case.pdf'); // primary -> secondary
 */

import log from '../logger.js';
import { StorageAdapter } from './StorageAdapter.js';

export class DualWriteAdapter extends StorageAdapter {
  /**
   * @param {StorageAdapter} primary - Primary storage (authoritative, new)
   * @param {StorageAdapter} secondary - Secondary storage (fallback, legacy)
   */
  constructor(primary, secondary) {
    super();

    if (!primary || !secondary) {
      throw new Error('DualWriteAdapter: primary and secondary adapters required');
    }

    this.primary = primary;
    this.secondary = secondary;

    log.info('DualWriteAdapter: initialized', {
      primary: primary.getProviderName(),
      secondary: secondary.getProviderName(),
    });
  }

  /**
   * Write to both primary and secondary storage.
   * Primary write is awaited; secondary write is best-effort.
   *
   * @async
   * @param {string} key - Object key
   * @param {Buffer|string} data - File content
   * @param {Object} options - Metadata
   * @returns {Promise<void>} Resolves when primary write completes
   */
  async put(key, data, options = {}) {
    try {
      // Write to primary (must succeed)
      await this.primary.put(key, data, options);
      log.debug('DualWriteAdapter: put (primary)', { key });

      // Write to secondary (best effort, non-blocking)
      this.secondary.put(key, data, options).catch((err) => {
        log.warn('DualWriteAdapter: put (secondary) failed', { key, error: err.message });
        // Non-fatal: primary succeeded, secondary failure is acceptable during migration
      });
    } catch (err) {
      log.error('DualWriteAdapter: put (primary) failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Read from primary with fallback to secondary.
   * If found in secondary but not primary, backfill to primary.
   *
   * @async
   * @param {string} key - Object key
   * @returns {Promise<Buffer|null>} File content or null if not found
   */
  async get(key) {
    try {
      // Try primary first
      const primaryData = await this.primary.get(key);
      if (primaryData !== null) {
        log.debug('DualWriteAdapter: get (primary hit)', { key });
        return primaryData;
      }

      // Fallback to secondary
      log.debug('DualWriteAdapter: get (primary miss, checking secondary)', { key });
      const secondaryData = await this.secondary.get(key);

      if (secondaryData !== null) {
        log.info('DualWriteAdapter: get (secondary hit, backfilling)', { key });

        // Backfill to primary (async, best effort)
        this.primary.put(key, secondaryData).catch((err) => {
          log.warn('DualWriteAdapter: backfill to primary failed', {
            key,
            error: err.message,
          });
        });

        return secondaryData;
      }

      // Not found in either storage
      log.debug('DualWriteAdapter: get (not found)', { key });
      return null;
    } catch (err) {
      log.error('DualWriteAdapter: get failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Delete from both primary and secondary.
   * Primary delete is awaited; secondary delete is best-effort.
   *
   * @async
   * @param {string} key - Object key
   * @returns {Promise<void>}
   */
  async delete(key) {
    try {
      // Delete from primary (must succeed)
      await this.primary.delete(key);
      log.debug('DualWriteAdapter: delete (primary)', { key });

      // Delete from secondary (best effort, non-blocking)
      this.secondary.delete(key).catch((err) => {
        log.warn('DualWriteAdapter: delete (secondary) failed', { key, error: err.message });
      });
    } catch (err) {
      log.error('DualWriteAdapter: delete failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Check existence in primary first, then secondary.
   *
   * @async
   * @param {string} key - Object key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    try {
      // Check primary first
      const existsInPrimary = await this.primary.exists(key);
      if (existsInPrimary) {
        log.debug('DualWriteAdapter: exists (primary)', { key, exists: true });
        return true;
      }

      // Fallback to secondary
      const existsInSecondary = await this.secondary.exists(key);
      log.debug('DualWriteAdapter: exists (secondary)', {
        key,
        exists: existsInSecondary,
      });
      return existsInSecondary;
    } catch (err) {
      log.error('DualWriteAdapter: exists failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * List files from primary with secondary fallback.
   *
   * @async
   * @param {string} prefix - Key prefix
   * @returns {Promise<Array>} Array of file metadata objects
   */
  async list(prefix = '') {
    try {
      // List from primary first
      const primaryResults = await this.primary.list(prefix);
      if (primaryResults && primaryResults.length > 0) {
        log.debug('DualWriteAdapter: list (primary)', { prefix, count: primaryResults.length });
        return primaryResults;
      }

      // Fallback to secondary
      const secondaryResults = await this.secondary.list(prefix);
      log.debug('DualWriteAdapter: list (secondary)', {
        prefix,
        count: secondaryResults.length,
      });
      return secondaryResults;
    } catch (err) {
      log.error('DualWriteAdapter: list failed', { prefix, error: err.message });
      throw err;
    }
  }

  /**
   * Generate pre-signed URL from primary with secondary fallback.
   *
   * @async
   * @param {string} key - Object key
   * @param {number} expiresIn - URL expiration in seconds
   * @returns {Promise<string>} Pre-signed URL
   */
  async getSignedUrl(key, expiresIn = 3600) {
    try {
      // Try primary first
      const primaryUrl = await this.primary.getSignedUrl(key, expiresIn);
      log.debug('DualWriteAdapter: getSignedUrl (primary)', { key });
      return primaryUrl;
    } catch (err) {
      // Fallback to secondary
      log.debug('DualWriteAdapter: getSignedUrl (primary failed, using secondary)', {
        key,
        error: err.message,
      });

      try {
        const secondaryUrl = await this.secondary.getSignedUrl(key, expiresIn);
        return secondaryUrl;
      } catch (secondaryErr) {
        log.error('DualWriteAdapter: getSignedUrl failed', {
          key,
          primaryError: err.message,
          secondaryError: secondaryErr.message,
        });
        throw secondaryErr;
      }
    }
  }

  /**
   * Copy within primary; secondary is kept in sync if primary succeeds.
   *
   * @async
   * @param {string} srcKey - Source object key
   * @param {string} destKey - Destination object key
   * @returns {Promise<void>}
   */
  async copy(srcKey, destKey) {
    try {
      // Copy in primary (must succeed)
      await this.primary.copy(srcKey, destKey);
      log.debug('DualWriteAdapter: copy (primary)', { srcKey, destKey });

      // Copy in secondary (best effort)
      this.secondary.copy(srcKey, destKey).catch((err) => {
        log.warn('DualWriteAdapter: copy (secondary) failed', {
          srcKey,
          destKey,
          error: err.message,
        });
      });
    } catch (err) {
      log.error('DualWriteAdapter: copy failed', { srcKey, destKey, error: err.message });
      throw err;
    }
  }

  /**
   * Get metadata from primary with secondary fallback.
   *
   * @async
   * @param {string} key - Object key
   * @returns {Promise<Object|null>} Metadata object or null if not found
   */
  async getMetadata(key) {
    try {
      // Try primary first
      const primaryMeta = await this.primary.getMetadata(key);
      if (primaryMeta !== null) {
        log.debug('DualWriteAdapter: getMetadata (primary)', { key });
        return primaryMeta;
      }

      // Fallback to secondary
      const secondaryMeta = await this.secondary.getMetadata(key);
      if (secondaryMeta !== null) {
        log.debug('DualWriteAdapter: getMetadata (secondary)', { key });
      }
      return secondaryMeta;
    } catch (err) {
      log.error('DualWriteAdapter: getMetadata failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Get provider name identifier.
   *
   * @returns {string} 'dual'
   */
  getProviderName() {
    return 'dual';
  }
}
