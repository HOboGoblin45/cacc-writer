/**
 * server/storage/S3StorageAdapter.js
 * ==================================
 * Storage adapter for Amazon S3.
 *
 * Implements StorageAdapter interface for AWS S3 with standard endpoints.
 * Note: Cloudflare R2 is recommended over S3 for cost (~30x cheaper with egress).
 *
 * Configuration via environment variables:
 * - S3_BUCKET: Bucket name
 * - AWS_ACCESS_KEY_ID: AWS API access key
 * - AWS_SECRET_ACCESS_KEY: AWS API secret key
 * - AWS_REGION: AWS region (default: 'us-east-1')
 *
 * @example
 * const storage = new S3StorageAdapter({
 *   bucket: process.env.S3_BUCKET,
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 *   region: process.env.AWS_REGION || 'us-east-1',
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
      log.error('S3StorageAdapter: failed to load @aws-sdk/client-s3', {
        error: err.message,
        hint: 'npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner',
      });
      throw new Error('AWS SDK not available for S3 storage');
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

export class S3StorageAdapter extends StorageAdapter {
  /**
   * @param {Object} config
   * @param {string} config.bucket - S3 bucket name
   * @param {string} config.accessKeyId - AWS access key ID
   * @param {string} config.secretAccessKey - AWS secret access key
   * @param {string} config.region - AWS region (default: 'us-east-1')
   */
  constructor(config = {}) {
    super();

    this.bucket = config.bucket || process.env.S3_BUCKET;
    this.accessKeyId = config.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
    this.secretAccessKey = config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
    this.region = config.region || process.env.AWS_REGION || 'us-east-1';

    if (!this.bucket || !this.accessKeyId || !this.secretAccessKey) {
      throw new Error(
        'S3StorageAdapter: missing required config. ' +
        'Provide bucket, accessKeyId, secretAccessKey or set ' +
        'S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY env vars'
      );
    }

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
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });
      log.info('S3StorageAdapter: initialized S3Client', {
        region: this.region,
        bucket: this.bucket,
      });
    }
    return this.client;
  }

  /**
   * Store file to S3.
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
      log.debug('S3StorageAdapter: put', { key, size: buffer.length });
    } catch (err) {
      log.error('S3StorageAdapter: put failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Retrieve file from S3.
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
      log.debug('S3StorageAdapter: get', { key, size: buffer.length });
      return buffer;
    } catch (err) {
      if (err.name === 'NoSuchKey') {
        return null;
      }
      log.error('S3StorageAdapter: get failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Delete file from S3.
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
      log.debug('S3StorageAdapter: delete', { key });
    } catch (err) {
      log.error('S3StorageAdapter: delete failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Check if file exists in S3.
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
        log.debug('S3StorageAdapter: exists', { key, exists: true });
        return true;
      } catch (err) {
        if (err.name === 'NoSuchKey') {
          log.debug('S3StorageAdapter: exists', { key, exists: false });
          return false;
        }
        throw err;
      }
    } catch (err) {
      log.error('S3StorageAdapter: exists failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * List files in S3 with optional prefix filtering.
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

      log.debug('S3StorageAdapter: list', { prefix, count: results.length });
      return results;
    } catch (err) {
      log.error('S3StorageAdapter: list failed', { prefix, error: err.message });
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

      log.debug('S3StorageAdapter: getSignedUrl', { key, expiresIn });
      return url;
    } catch (err) {
      log.error('S3StorageAdapter: getSignedUrl failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Copy file from source to destination in S3.
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
      log.debug('S3StorageAdapter: copy', { srcKey, destKey });
    } catch (err) {
      log.error('S3StorageAdapter: copy failed', { srcKey, destKey, error: err.message });
      throw err;
    }
  }

  /**
   * Get file metadata from S3.
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
        log.debug('S3StorageAdapter: getMetadata', { key, ...metadata });
        return metadata;
      } catch (err) {
        if (err.name === 'NoSuchKey') {
          return null;
        }
        throw err;
      }
    } catch (err) {
      log.error('S3StorageAdapter: getMetadata failed', { key, error: err.message });
      throw err;
    }
  }

  /**
   * Get provider name identifier.
   *
   * @returns {string} 's3'
   */
  getProviderName() {
    return 's3';
  }
}
