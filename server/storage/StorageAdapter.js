/**
 * server/storage/StorageAdapter.js
 * ================================
 * Abstract base class defining the unified storage interface.
 * All storage providers (local filesystem, S3, R2) implement these methods.
 *
 * This interface abstracts away provider-specific details and enables
 * zero-downtime migration with dual-write support.
 *
 * @example
 * const storage = getStorageAdapter();
 * const buffer = await storage.get('knowledge_base/index.json');
 * await storage.put('exports/case-123.pdf', data, { contentType: 'application/pdf' });
 */

export class StorageAdapter {
  /**
   * Store a file or buffer.
   *
   * @async
   * @param {string} key - Object key/path (e.g., 'knowledge_base/index.json')
   * @param {Buffer|string} data - File content (Buffer or UTF-8 string)
   * @param {Object} options - Optional metadata
   * @param {string} options.contentType - MIME type (e.g., 'application/json')
   * @param {Object} options.metadata - Custom metadata key-value pairs
   * @returns {Promise<void>}
   * @throws {Error} Implementation must throw on I/O failure
   */
  async put(key, data, options = {}) {
    throw new Error('StorageAdapter.put() is not implemented');
  }

  /**
   * Retrieve a file or buffer.
   *
   * @async
   * @param {string} key - Object key/path
   * @returns {Promise<Buffer|null>} File content as Buffer, or null if not found
   * @throws {Error} Implementation must throw on I/O failure (not including NotFound)
   */
  async get(key) {
    throw new Error('StorageAdapter.get() is not implemented');
  }

  /**
   * Delete a file.
   *
   * @async
   * @param {string} key - Object key/path
   * @returns {Promise<void>} Resolves successfully even if file does not exist
   * @throws {Error} Implementation must throw on I/O failure
   */
  async delete(key) {
    throw new Error('StorageAdapter.delete() is not implemented');
  }

  /**
   * Check if a file exists.
   *
   * @async
   * @param {string} key - Object key/path
   * @returns {Promise<boolean>} True if file exists, false otherwise
   * @throws {Error} Implementation must throw on I/O failure
   */
  async exists(key) {
    throw new Error('StorageAdapter.exists() is not implemented');
  }

  /**
   * List files matching a prefix.
   *
   * @async
   * @param {string} prefix - Key prefix to filter by (e.g., 'knowledge_base/')
   * @returns {Promise<Array<{key: string, size: number, lastModified: Date}>>}
   * @throws {Error} Implementation must throw on I/O failure
   */
  async list(prefix = '') {
    throw new Error('StorageAdapter.list() is not implemented');
  }

  /**
   * Generate a pre-signed URL for direct download/access.
   *
   * @async
   * @param {string} key - Object key/path
   * @param {number} expiresIn - URL expiration in seconds (default: 3600 = 1 hour)
   * @returns {Promise<string>} Pre-signed URL
   * @throws {Error} Implementation must throw on I/O failure
   */
  async getSignedUrl(key, expiresIn = 3600) {
    throw new Error('StorageAdapter.getSignedUrl() is not implemented');
  }

  /**
   * Copy a file from one location to another.
   *
   * @async
   * @param {string} srcKey - Source object key
   * @param {string} destKey - Destination object key
   * @returns {Promise<void>}
   * @throws {Error} Implementation must throw on I/O failure or source not found
   */
  async copy(srcKey, destKey) {
    throw new Error('StorageAdapter.copy() is not implemented');
  }

  /**
   * Get file metadata (size, modification time, content type, etc.).
   *
   * @async
   * @param {string} key - Object key/path
   * @returns {Promise<{size: number, lastModified: Date, contentType?: string}>}
   * @returns {Promise<null>} Returns null if file does not exist
   * @throws {Error} Implementation must throw on I/O failure
   */
  async getMetadata(key) {
    throw new Error('StorageAdapter.getMetadata() is not implemented');
  }

  /**
   * Get the storage provider name.
   *
   * @returns {string} Provider identifier: 'local', 's3', 'r2', or custom name
   */
  getProviderName() {
    throw new Error('StorageAdapter.getProviderName() is not implemented');
  }
}
