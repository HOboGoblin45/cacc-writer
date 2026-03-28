/**
 * server/storage/R2StorageAdapter.js
 * ==================================
 * Storage adapter for Cloudflare R2 (S3-compatible API).
 *
 * Cloudflare R2 advantages:
 * - Zero egress fees (vs $0.09/GB for AWS S3)
 * - S3-compatible API (@aws-sdk/client-s3)
 * - Global distribution with auto geo-replication
 * - Included CDN (R2 sFLY) with no additional cost
 *
 * Configuration via environment variables:
 * - R2_BUCKET: Bucket name
 * - R2_ACCOUNT_ID: Cloudflare account ID (e.g., 'abc123')
 * - R2_ACCESS_KEY_ID: R2 API token (access key ID)
 * - R2_SECRET_ACCESS_KEY: R2 API token secret
 *
 * @example
 * const storage = new R2StorageAdapter({
 *   bucket: process.env.R2_BUCKET,
 *   accountId: process.env.R2_ACCOUNT_ID,
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
 * });
 */

import log from '../logger.js';
import { StorageAdapter } from './StorageAdapter.js';

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand;
let HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand;
let getSignedUrl;

// Lazy load AWS SDK (may not be installed)
async function ensureAwsSdk() {
  if (!S3Client) {
    try {
      const s3Module = await import('@aws-sdk/client-s3');
      S3Client = s3Module.S3Client;
      PutObjectCommand = s3Module.PutObjectCommand;
      GetObjectCommand = s3Module.GetObjectCommand;
      DeleteObjectCommand = s3Module.DeleteObjectCommand;
      HeadObjectCommand = s3Module.HeadObjectCommand;
      ListObjectsV2Command = s3Module.ListObjectsV2Command;
      CopyObjectCommand = s3Module.CopyObjectCommand;

      const presignerModule = await import('@aws-sdk/s3-request-presigner');
      getSignedUrl = presignerModule.getSignedUrl;
    } catch (err) {
      log.error('R2StorageAdapter: failed to load @aws-sdk/client-s3', {
        error: err.message,
        hint: 'npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner',
      });
      throw new Error('AWS SDK not available for R2 storage');
    }
  }
}

/**
 * Utility: Convert readable stream to Buffer.
 */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export class R2StorageAdapter extends StorageAdapter {
  /**
   * @param {Object} config
   * @param {string} config.bucket - R2 bucket name
   * @param {string} config.accountId - Cloudflare account ID
   * @param {string} config.accessKeyId - R2 API token (access key ID)
   * @param {string} config.secretAccessKey - R2 API token secret
   * @param {string} config.region - AWS region (default: 'auto')
   */
  constructor(config = {}) {
    super();

    this.bucket = config.bucket || process.env.R2_BUCKET;
    this.accountId = config.accountId || process.env.R2_ACCOUNT_ID;
    this.accessKeyId = config.accessKeyId || process.env.R2_ACCESS_KEY_ID;
    this.secretAccessKey = config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;
    this.region = config.region || 'auto';

    if (!this.bucket || !this.accountId || !this.accessKeyId || !this.secretAccessKey) {
      throw new Error(
        'R2StorageAdapter: missing required config. ' +
        'Provide bucket, accountId, accessKeyId, secretAccessKey or set ' +
        'R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY env vars'
      );
    }

    this.endpoint = `https://${this.accountId}.r2.cloudflarestorage.com`;
    this.client = null;
  }

  /**
   * Initialize S3Client (lazy initialization).
   */
  async _getClient() {
    if (!this.client) {
      await ensureAwsSdk();
      this.client = new S3Client({
        region: this.region,
        endpoint: this.endpoint,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });
      log.info('R2StorageAdapter: initialized S3Client', {
        endpoint: this.endpoint,
        bucket: this.bucket,
      });
    }
    return this.client;
  }

  /**
   * Store file to R2.
   *
   * @async
   * @param {string} key - Object key (e.g., 'knowledge_base/index.json')
   * @param {Buffer|string} data - File content
   * @param {Object} options - Metadata
   * @param {string} options.contentType - MIME type
   * @param {Object} options.metadata - Custom metadata key-value pairs
   * @returns {Promise<void>}
   */
  async put(key, data, options = {}) {
    try {
      const client = await this._getClient();
      const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

      const params = {
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: options.contentType || 'application/octet-stream',
      };

      if (options.metadata && Object.keys(options.metadata).length > 0) {
        params.Metadata = options.metadata;
      }

      await client.send(new PutObjectCommand(params));
      log.debug('R2StorageAdapter: put', { key, size: buffer.length });
    } catch (err) {
      log.error('R2StorageAdapter: put failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Retrieve file from R2.
   *
   * @async
   * @param {string} key - Object key
   * @returns {Promise<Buffer|null>} File content or null if not found
   */
  async get(key) {
    try {
      const client = await this._getClient();

      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      const response = await client.send(new GetObjectCommand(params));
      const buffer = await streamToBuffer(response.Body);
      log.debug('R2StorageAdapter: get', { key, size: buffer.length });
      return buffer;
    } catch (err) {
      if (err.name === 'NoSuchKey') {
        return null;
      }
      log.error('R2StorageAdapter: get failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Delete file from R2.
   *
   * @async
   * @param {string} key - Object key
   * @returns {Promise<void>} Success even if file doesn't exist
   */
  async delete(key) {
    try {
      const client = await this._getClient();

      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      await client.send(new DeleteObjectCommand(params));
      log.debug('R2StorageAdapter: delete', { key });
    } catch (err) {
      log.error('R2StorageAdapter: delete failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Check if file exists in R2.
   *
   * @async
   * @param {string} key - Object key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    try {
      const client = await this._getClient();

      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      try {
        await client.send(new HeadObjectCommand(params));
        log.debug('R2StorageAdapter: exists', { key, exists: true });
        return true;
      } catch (err) {
        if (err.name === 'NoSuchKey') {
          log.debug('R2StorageAdapter: exists', { key, exists: false });
          return false;
        }
        throw err;
      }
    } catch (err) {
      log.error('R2StorageAdapter: exists failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * List files in R2 with optional prefix filtering.
   *
   * @async
   * @param {string} prefix - Key prefix (e.g., 'knowledge_base/')
   * @returns {Promise<Array<{key, size, lastModified}>>}
   */
  async list(prefix = '') {
    try {
      const client = await this._getClient();
      const results = [];
      let continuationToken;

      do {
        const params = {
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        };

        const response = await client.send(new ListObjectsV2Command(params));

        if (response.Contents) {
          for (const obj of response.Contents) {
            results.push({
              key: obj.Key,
              size: obj.Size,
              lastModified: obj.LastModified,
            });
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      log.debug('R2StorageAdapter: list', { prefix, count: results.length });
      return results;
    } catch (err) {
      log.error('R2StorageAdapter: list failed', { prefix, error: err.message });
      throw err;
    }
  }

  /**
   * Generate pre-signed URL for direct download/access.
   *
   * @async
   * @param {string} key - Object key
   * @param {number} expiresIn - URL expiration in seconds (default: 3600)
   * @returns {Promise<string>} Pre-signed HTTPS URL
   */
  async getSignedUrl(key, expiresIn = 3600) {
    try {
      await ensureAwsSdk();
      const client = await this._getClient();

      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      const url = await getSignedUrl(client, new GetObjectCommand(params), {
        expiresIn,
      });

      log.debug('R2StorageAdapter: getSignedUrl', { key, expiresIn });
      return url;
    } catch (err) {
      log.error('R2StorageAdapter: getSignedUrl failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Copy file from source to destination in R2.
   *
   * @async
   * @param {string} srcKey - Source object key
   * @param {string} destKey - Destination object key
   * @returns {Promise<void>}
   */
  async copy(srcKey, destKey) {
    try {
      const client = await this._getClient();

      const params = {
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${srcKey}`,
        Key: destKey,
      };

      await client.send(new CopyObjectCommand(params));
      log.debug('R2StorageAdapter: copy', { srcKey, destKey });
    } catch (err) {
      log.error('R2StorageAdapter: copy failed', { srcKey, destKey, error: err.message });
      throw err;
    }
  }

  /**
   * Get file metadata from R2.
   *
   * @async
   * @param {string} key - Object key
   * @returns {Promise<{size, lastModified, contentType}|null>}
   */
  async getMetadata(key) {
    try {
      const client = await this._getClient();

      const params = {
        Bucket: this.bucket,
        Key: key,
      };

      try {
        const response = await client.send(new HeadObjectCommand(params));
        const metadata = {
          size: response.ContentLength,
          lastModified: response.LastModified,
          contentType: response.ContentType,
        };
        log.debug('R2StorageAdapter: getMetadata', { key, ...metadata });
        return metadata;
      } catch (err) {
        if (err.name === 'NoSuchKey') {
          return null;
        }
        throw err;
      }
    } catch (err) {
      log.error('R2StorageAdapter: getMetadata failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Get provider name identifier.
   *
   * @returns {string} 'r2'
   */
  getProviderName() {
    return 'r2';
  }
}
