/**
 * server/storage/StorageFactory.js
 * ================================
 * Factory function to create appropriate storage adapter based on configuration.
 *
 * Supports:
 * - 'local': Node.js filesystem (default)
 * - 's3': Amazon S3
 * - 'r2': Cloudflare R2 (recommended, egress-free)
 * - 'dual': Dual-write for zero-downtime migration
 *
 * Configuration:
 * Environment variable: STORAGE_PROVIDER
 * Or pass config object: createStorageAdapter({ provider: 'r2', ... })
 *
 * @example
 * // Default: local filesystem
 * const storage = createStorageAdapter();
 *
 * // Explicit R2
 * const storage = createStorageAdapter({ provider: 'r2' });
 *
 * // Dual-write for migration
 * const storage = createStorageAdapter({
 *   provider: 'dual',
 *   primaryProvider: 'r2',
 *   secondaryProvider: 'local',
 * });
 *
 * // Global singleton
 * const storage = getStorageAdapter();
 */

import log from '../logger.js';
import { StorageAdapter } from './StorageAdapter.js';
import { LocalStorageAdapter } from './LocalStorageAdapter.js';
import { R2StorageAdapter } from './R2StorageAdapter.js';
import { S3StorageAdapter } from './S3StorageAdapter.js';
import { DualWriteAdapter } from './DualWriteAdapter.js';

/**
 * Create a storage adapter instance based on configuration.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.provider - Storage provider ('local', 's3', 'r2', 'dual')
 * @param {string} config.basePath - For local storage
 * @param {string} config.bucket - For S3/R2
 * @param {string} config.accountId - For R2
 * @param {string} config.accessKeyId - For S3/R2
 * @param {string} config.secretAccessKey - For S3/R2
 * @param {string} config.region - For S3/R2
 * @param {string} config.primaryProvider - For dual-write
 * @param {string} config.secondaryProvider - For dual-write
 *
 * @returns {StorageAdapter} Storage adapter instance
 * @throws {Error} If configuration is invalid or dependencies missing
 */
export function createStorageAdapter(config = {}) {
  const provider = config.provider || process.env.STORAGE_PROVIDER || 'local';

  log.info('createStorageAdapter', { provider });

  switch (provider) {
    case 'local': {
      return new LocalStorageAdapter({
        basePath: config.basePath || process.env.STORAGE_BASE_PATH,
      });
    }

    case 's3': {
      return new S3StorageAdapter({
        bucket: config.bucket || process.env.S3_BUCKET,
        accessKeyId: config.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
        region: config.region || process.env.AWS_REGION,
      });
    }

    case 'r2': {
      return new R2StorageAdapter({
        bucket: config.bucket || process.env.R2_BUCKET,
        accountId: config.accountId || process.env.R2_ACCOUNT_ID,
        accessKeyId: config.accessKeyId || process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY,
        region: config.region || process.env.R2_REGION || 'auto',
      });
    }

    case 'dual': {
      const primaryProvider = config.primaryProvider || process.env.STORAGE_PRIMARY_PROVIDER || 'r2';
      const secondaryProvider = config.secondaryProvider || process.env.STORAGE_SECONDARY_PROVIDER || 'local';

      const primary = createStorageAdapter({ ...config, provider: primaryProvider });
      const secondary = createStorageAdapter({ ...config, provider: secondaryProvider });

      return new DualWriteAdapter(primary, secondary);
    }

    default: {
      log.warn('createStorageAdapter: unknown provider, defaulting to local', { provider });
      return new LocalStorageAdapter({
        basePath: config.basePath || process.env.STORAGE_BASE_PATH,
      });
    }
  }
}

/**
 * Global default storage adapter (singleton pattern).
 * Initialized on first call, reused afterward.
 */
let _defaultAdapter = null;

/**
 * Get the global default storage adapter.
 * Creates instance on first call using STORAGE_PROVIDER env var.
 *
 * @returns {StorageAdapter} Default storage adapter
 *
 * @example
 * const storage = getStorageAdapter();
 * const data = await storage.get('knowledge_base/index.json');
 */
export function getStorageAdapter() {
  if (!_defaultAdapter) {
    _defaultAdapter = createStorageAdapter();
  }
  return _defaultAdapter;
}

/**
 * Reset the global default storage adapter (for testing).
 *
 * @internal
 */
export function _resetStorageAdapter() {
  _defaultAdapter = null;
}

/**
 * Set the global default storage adapter (for testing/override).
 *
 * @param {StorageAdapter} adapter - Storage adapter instance
 * @internal
 */
export function _setStorageAdapter(adapter) {
  if (!adapter || !(adapter instanceof StorageAdapter)) {
    throw new Error('_setStorageAdapter: invalid adapter');
  }
  _defaultAdapter = adapter;
}
