/**
 * server/storage/LocalStorageAdapter.js
 * ====================================
 * Storage adapter for local filesystem (Node.js fs module).
 *
 * Implements StorageAdapter interface for backward compatibility.
 * Used as default provider and fallback when cloud storage is unavailable.
 *
 * Directory Structure:
 * - basePath/
 *   ├── knowledge_base/
 *   ├── exports/
 *   ├── users/
 *   └── backups/
 *
 * Features:
 * - Atomic writes via temporary file + rename pattern
 * - Recursive directory creation
 * - Metadata inference from file stats
 * - No network I/O (always available)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../logger.js';
import { StorageAdapter } from './StorageAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class LocalStorageAdapter extends StorageAdapter {
  /**
   * @param {Object} config
   * @param {string} config.basePath - Base directory for all files (default: ./data)
   */
  constructor(config = {}) {
    super();
    this.basePath = config.basePath || process.env.STORAGE_BASE_PATH || './data';

    // Ensure base path exists
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true, mode: 0o700 });
      log.info('LocalStorageAdapter: created base path', { basePath: this.basePath });
    }
  }

  /**
   * Store file to local filesystem.
   * Uses atomic write pattern: write to temp file, then rename.
   *
   * @async
   * @param {string} key - Relative path (e.g., 'knowledge_base/index.json')
   * @param {Buffer|string} data - File content
   * @param {Object} options - Metadata (contentType, metadata ignored for local)
   * @returns {Promise<void>}
   */
  async put(key, data, options = {}) {
    try {
      const fullPath = path.join(this.basePath, key);
      const dir = path.dirname(fullPath);

      // Ensure parent directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      // Convert string to Buffer if needed
      const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

      // Atomic write: temp file + rename
      const tmpPath = fullPath + '.tmp';
      fs.writeFileSync(tmpPath, buffer, { mode: 0o600 });
      fs.renameSync(tmpPath, fullPath);

      log.debug('LocalStorageAdapter: put', {
        key,
        size: buffer.length,
        contentType: options.contentType,
      });
    } catch (err) {
      log.error('LocalStorageAdapter: put failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Retrieve file from local filesystem.
   *
   * @async
   * @param {string} key - Relative path
   * @returns {Promise<Buffer|null>} File content or null if not found
   */
  async get(key) {
    try {
      const fullPath = path.join(this.basePath, key);

      if (!fs.existsSync(fullPath)) {
        return null;
      }

      const buffer = fs.readFileSync(fullPath);
      log.debug('LocalStorageAdapter: get', { key, size: buffer.length });
      return buffer;
    } catch (err) {
      log.error('LocalStorageAdapter: get failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Delete file from local filesystem.
   *
   * @async
   * @param {string} key - Relative path
   * @returns {Promise<void>} Success even if file doesn't exist
   */
  async delete(key) {
    try {
      const fullPath = path.join(this.basePath, key);

      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        log.debug('LocalStorageAdapter: delete', { key });
      }
    } catch (err) {
      log.error('LocalStorageAdapter: delete failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Check if file exists.
   *
   * @async
   * @param {string} key - Relative path
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    try {
      const fullPath = path.join(this.basePath, key);
      const exists = fs.existsSync(fullPath);
      log.debug('LocalStorageAdapter: exists', { key, exists });
      return exists;
    } catch (err) {
      log.error('LocalStorageAdapter: exists failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * List files matching prefix with recursive directory traversal.
   *
   * @async
   * @param {string} prefix - Key prefix (e.g., 'knowledge_base/')
   * @returns {Promise<Array<{key, size, lastModified}>>}
   */
  async list(prefix = '') {
    try {
      const results = [];
      const prefixPath = path.join(this.basePath, prefix);

      if (!fs.existsSync(prefixPath)) {
        return results;
      }

      const walk = (dir, prefixForKey) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const key = path.join(prefixForKey, entry.name).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            walk(fullPath, key);
          } else {
            const stat = fs.statSync(fullPath);
            results.push({
              key,
              size: stat.size,
              lastModified: stat.mtime,
            });
          }
        }
      };

      walk(prefixPath, prefix);
      log.debug('LocalStorageAdapter: list', { prefix, count: results.length });
      return results;
    } catch (err) {
      log.error('LocalStorageAdapter: list failed', { prefix, error: err.message });
      throw err;
    }
  }

  /**
   * Generate a file:// URL (local-only, no real signing).
   *
   * @async
   * @param {string} key - Relative path
   * @param {number} expiresIn - Ignored (no expiration for local files)
   * @returns {Promise<string>} file:// URL
   */
  async getSignedUrl(key, expiresIn = 3600) {
    try {
      const fullPath = path.resolve(path.join(this.basePath, key));
      const url = `file://${fullPath}`;
      log.debug('LocalStorageAdapter: getSignedUrl', { key, url });
      return url;
    } catch (err) {
      log.error('LocalStorageAdapter: getSignedUrl failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Copy file from source to destination.
   *
   * @async
   * @param {string} srcKey - Source relative path
   * @param {string} destKey - Destination relative path
   * @returns {Promise<void>}
   */
  async copy(srcKey, destKey) {
    try {
      const srcPath = path.join(this.basePath, srcKey);
      const destPath = path.join(this.basePath, destKey);

      if (!fs.existsSync(srcPath)) {
        throw new Error(`Source file not found: ${srcKey}`);
      }

      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      fs.copyFileSync(srcPath, destPath);
      log.debug('LocalStorageAdapter: copy', { srcKey, destKey });
    } catch (err) {
      log.error('LocalStorageAdapter: copy failed', { srcKey, destKey, error: err.message });
      throw err;
    }
  }

  /**
   * Get file metadata: size, modification time, content type.
   *
   * @async
   * @param {string} key - Relative path
   * @returns {Promise<{size, lastModified, contentType}|null>}
   */
  async getMetadata(key) {
    try {
      const fullPath = path.join(this.basePath, key);

      if (!fs.existsSync(fullPath)) {
        return null;
      }

      const stat = fs.statSync(fullPath);
      const ext = path.extname(key).toLowerCase();

      // Infer content type from extension
      const contentTypeMap = {
        '.json': 'application/json',
        '.pdf': 'application/pdf',
        '.xml': 'application/xml',
        '.zip': 'application/zip',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
      };

      const metadata = {
        size: stat.size,
        lastModified: stat.mtime,
        contentType: contentTypeMap[ext] || 'application/octet-stream',
      };

      log.debug('LocalStorageAdapter: getMetadata', { key, ...metadata });
      return metadata;
    } catch (err) {
      log.error('LocalStorageAdapter: getMetadata failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Get provider name identifier.
   *
   * @returns {string} 'local'
   */
  getProviderName() {
    return 'local';
  }
}
