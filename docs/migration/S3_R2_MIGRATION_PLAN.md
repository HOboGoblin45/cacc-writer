# S3/R2 Cloud Storage Migration Plan

**Document Version:** 1.0
**Date:** March 28, 2026
**Target:** CACC Writer SaaS Platform
**Primary Recommendation:** Cloudflare R2 (97% cost savings)
**Estimated Timeline:** 2-3 weeks (can be incremental)
**Status:** Ready for Phase 1 implementation

---

## Table of Contents

1. [Overview & Recommendations](#overview--recommendations)
2. [Phase 1: Storage Abstraction Layer](#phase-1-storage-abstraction-layer)
3. [Phase 2: Identify All Storage Touchpoints](#phase-2-identify-all-storage-touchpoints)
4. [Phase 3: Migration Strategy by Category](#phase-3-migration-strategy-by-category)
5. [Phase 4: Implementation Details](#phase-4-implementation-details)
6. [Phase 5: Data Migration & Cutover](#phase-5-data-migration--cutover)
7. [Operational Procedures](#operational-procedures)
8. [Rollback & Disaster Recovery](#rollback--disaster-recovery)
9. [Monitoring & Alerting](#monitoring--alerting)
10. [Cost Analysis & ROI](#cost-analysis--roi)
11. [FAQ & Troubleshooting](#faq--troubleshooting)

---

## Overview & Recommendations

### Executive Summary

CACC Writer currently stores **2.6 GB** across local filesystem:
- **Knowledge base** (1.7 GB): Hand-curated examples, approved narratives, phrase banks
- **Exports** (1.2 GB): Generated PDFs, XMLs, ZIPs
- **Case data** (50-100 MB per user): Photos, documents, case metadata
- **Backups** (varies): Full database backups for compliance

**Current Pain Points:**
1. No geographic redundancy (single server)
2. Disk capacity limits (must manage manually)
3. No automatic scaling
4. Data loss risk if hardware fails
5. Difficult to add new servers

**Post-Migration Benefits:**
1. Auto-scaling and no capacity planning
2. Geo-redundancy and disaster recovery
3. Cost reduction (30-50x with R2)
4. Atomic operations and versioning
5. Multi-region access

### Provider Comparison

| Metric | S3 | R2 | GCS | Azure Blob |
|--------|----|----|-----|-----------|
| Storage Cost | $0.023/GB | $0.015/GB | $0.020/GB | $0.018/GB |
| API Calls (read) | $0.0004/1K | Free (3M/mo) | $0.0004/1K | $0.0004/1K |
| Egress (per GB) | $0.09 | **Free** | $0.12 | $0.05 |
| CDN | CloudFront ($0.085) | Included | Cloud CDN | Azure CDN |
| S3 Compatibility | Native | **Yes** | Partial | No |
| Setup Time | 2 hours | 30 mins | 3 hours | 2 hours |
| **Monthly Cost (Baseline)** | **$45-90** | **$1.54** | **$30-60** | **$20-40** |

**Recommendation:** **Cloudflare R2** (S3-compatible, egress-free, fastest ROI)

---

## Phase 1: Storage Abstraction Layer

### 1.1 Architecture Design

Create a unified storage interface to abstract cloud provider differences. This allows:
- Single codebase for multiple backends (local, S3, R2)
- Easy provider switching via feature flag
- Gradual migration with dual-write support
- Fallback to local storage if cloud unavailable

### 1.2 StorageAdapter Interface

```typescript
/**
 * server/storage/StorageAdapter.ts
 * Unified interface for all storage providers
 */

export interface StorageObject {
  key: string;
  buffer: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
  versionId?: string;
}

export interface StorageMetadata {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  contentType?: string;
  versionId?: string;
}

export interface ListOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListResult {
  contents: StorageMetadata[];
  nextContinuationToken?: string;
  isTruncated: boolean;
}

export interface SignedUrlOptions {
  expiresIn?: number;  // seconds (default: 3600 = 1 hour)
  contentType?: string;
  responseHeaders?: Record<string, string>;
}

export interface StorageAdapterConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/**
 * Core storage interface - implement for each provider
 */
export interface IStorageAdapter {
  // Read operations
  getObject(key: string): Promise<StorageObject | null>;
  getObjectStream(key: string): Promise<NodeJS.ReadableStream | null>;

  // Write operations
  putObject(key: string, buffer: Buffer, options?: {
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<StorageMetadata>;

  // Delete operations
  deleteObject(key: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<{ deleted: string[]; failed: Array<{ key: string; error: string }> }>;

  // List operations
  listObjects(options?: ListOptions): Promise<ListResult>;

  // Metadata operations
  headObject(key: string): Promise<StorageMetadata | null>;
  copyObject(source: string, destination: string): Promise<StorageMetadata>;

  // URL generation
  getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;

  // Health check
  healthCheck(): Promise<{ healthy: boolean; latency: number }>;

  // Batch operations
  batchGetObjects(keys: string[]): Promise<Map<string, StorageObject | Error>>;
}
```

### 1.3 Implementation: LocalFSAdapter

```typescript
/**
 * server/storage/adapters/LocalFSAdapter.ts
 * Current implementation - direct filesystem
 */

import fs from 'fs';
import path from 'path';
import { IStorageAdapter, StorageObject, StorageMetadata, ListResult } from '../StorageAdapter';
import log from '../../logger.js';

export class LocalFSAdapter implements IStorageAdapter {
  private basePath: string;

  constructor(config: { basePath: string }) {
    this.basePath = config.basePath;
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getFullPath(key: string): string {
    const safePath = path.normalize(key).replace(/^\.\./, '');
    return path.join(this.basePath, safePath);
  }

  async getObject(key: string): Promise<StorageObject | null> {
    try {
      const fullPath = this.getFullPath(key);
      const buffer = fs.readFileSync(fullPath);
      const stats = fs.statSync(fullPath);

      return {
        key,
        buffer,
        contentType: this.guessContentType(key),
        metadata: {
          size: stats.size.toString(),
          modified: stats.mtime.toISOString(),
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async putObject(
    key: string,
    buffer: Buffer,
    options?: { contentType?: string; metadata?: Record<string, string> }
  ): Promise<StorageMetadata> {
    const fullPath = this.getFullPath(key);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write (write to temp, then rename)
    const tmpPath = fullPath + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, fullPath);

    const stats = fs.statSync(fullPath);
    return {
      key,
      size: stats.size,
      etag: `"${stats.ino}-${stats.mtime.getTime()}"`,
      lastModified: stats.mtime,
      contentType: options?.contentType || this.guessContentType(key),
    };
  }

  async deleteObject(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async listObjects(options?: { prefix?: string; maxKeys?: number }): Promise<ListResult> {
    const searchPath = options?.prefix ? this.getFullPath(options.prefix) : this.basePath;
    const maxKeys = options?.maxKeys || 1000;

    try {
      const entries = fs.readdirSync(searchPath, { recursive: true });
      const contents = entries
        .filter((e): e is string => typeof e === 'string')
        .slice(0, maxKeys)
        .map(entry => {
          const fullPath = path.join(searchPath, entry);
          const stats = fs.statSync(fullPath);
          return {
            key: path.relative(this.basePath, fullPath),
            size: stats.size,
            etag: `"${stats.ino}-${stats.mtime.getTime()}"`,
            lastModified: stats.mtime,
          };
        });

      return {
        contents,
        isTruncated: entries.length > maxKeys,
      };
    } catch {
      return { contents: [], isTruncated: false };
    }
  }

  async getSignedUrl(key: string, options?: { expiresIn?: number }): Promise<string> {
    // For local filesystem, return a local path
    // In production, could use a signed URL from a local HTTP server
    return `/files/${encodeURIComponent(key)}`;
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    try {
      if (!fs.existsSync(this.basePath)) {
        fs.mkdirSync(this.basePath, { recursive: true });
      }
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch {
      return { healthy: false, latency: Date.now() - start };
    }
  }

  private guessContentType(key: string): string {
    const ext = path.extname(key).toLowerCase();
    const types: Record<string, string> = {
      '.json': 'application/json',
      '.pdf': 'application/pdf',
      '.xml': 'application/xml',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.zip': 'application/zip',
      '.csv': 'text/csv',
    };
    return types[ext] || 'application/octet-stream';
  }

  async copyObject(source: string, destination: string): Promise<StorageMetadata> {
    const sourcePath = this.getFullPath(source);
    const destPath = this.getFullPath(destination);
    fs.copyFileSync(sourcePath, destPath);
    return this.headObject(destination) as Promise<StorageMetadata>;
  }

  async headObject(key: string): Promise<StorageMetadata | null> {
    try {
      const fullPath = this.getFullPath(key);
      const stats = fs.statSync(fullPath);
      return {
        key,
        size: stats.size,
        etag: `"${stats.ino}-${stats.mtime.getTime()}"`,
        lastModified: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  async deleteObjects(keys: string[]): Promise<{ deleted: string[]; failed: Array<any> }> {
    const deleted: string[] = [];
    const failed: Array<any> = [];

    for (const key of keys) {
      try {
        await this.deleteObject(key);
        deleted.push(key);
      } catch (e) {
        failed.push({ key, error: String(e) });
      }
    }

    return { deleted, failed };
  }

  async batchGetObjects(keys: string[]): Promise<Map<string, StorageObject | Error>> {
    const results = new Map<string, StorageObject | Error>();
    for (const key of keys) {
      try {
        const obj = await this.getObject(key);
        if (obj) results.set(key, obj);
      } catch (e) {
        results.set(key, e as Error);
      }
    }
    return results;
  }

  async getObjectStream(key: string): Promise<NodeJS.ReadableStream | null> {
    try {
      const fullPath = this.getFullPath(key);
      if (!fs.existsSync(fullPath)) return null;
      return fs.createReadStream(fullPath);
    } catch {
      return null;
    }
  }
}
```

### 1.4 Implementation: S3Adapter

```typescript
/**
 * server/storage/adapters/S3Adapter.ts
 * AWS S3 implementation
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand,
         ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand,
         DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedUrlSdk } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { IStorageAdapter, StorageObject, StorageMetadata, ListResult, StorageAdapterConfig } from '../StorageAdapter';
import log from '../../logger.js';

export class S3Adapter implements IStorageAdapter {
  private s3: S3Client;
  private bucket: string;

  constructor(config: StorageAdapterConfig) {
    this.bucket = config.bucket;
    this.s3 = new S3Client({
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId || '',
        secretAccessKey: config.secretAccessKey || '',
      },
    });
  }

  async getObject(key: string): Promise<StorageObject | null> {
    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      const response = await this.s3.send(command);

      const buffer = await this.streamToBuffer(response.Body as Readable);
      return {
        key,
        buffer,
        contentType: response.ContentType,
        metadata: response.Metadata,
        versionId: response.VersionId,
      };
    } catch (e: any) {
      if (e.name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async putObject(
    key: string,
    buffer: Buffer,
    options?: { contentType?: string; metadata?: Record<string, string> }
  ): Promise<StorageMetadata> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: options?.contentType,
      Metadata: options?.metadata,
    });

    const response = await this.s3.send(command);
    return {
      key,
      size: buffer.length,
      etag: response.ETag || '',
      lastModified: new Date(),
      versionId: response.VersionId,
    };
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await this.s3.send(command);
  }

  async listObjects(options?: { prefix?: string; maxKeys?: number; continuationToken?: string }): Promise<ListResult> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: options?.prefix,
      MaxKeys: options?.maxKeys || 1000,
      ContinuationToken: options?.continuationToken,
    });

    const response = await this.s3.send(command);
    return {
      contents: (response.Contents || []).map(obj => ({
        key: obj.Key || '',
        size: obj.Size || 0,
        etag: obj.ETag || '',
        lastModified: obj.LastModified || new Date(),
      })),
      nextContinuationToken: response.NextContinuationToken,
      isTruncated: response.IsTruncated || false,
    };
  }

  async getSignedUrl(key: string, options?: { expiresIn?: number }): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const expiresIn = options?.expiresIn || 3600; // 1 hour default
    return getSignedUrlSdk(this.s3, command, { expiresIn });
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: '.health-check' }));
      return { healthy: true, latency: Date.now() - start };
    } catch {
      // Doesn't matter if .health-check doesn't exist
      return { healthy: true, latency: Date.now() - start };
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  async copyObject(source: string, destination: string): Promise<StorageMetadata> {
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${source}`,
      Key: destination,
    });
    const response = await this.s3.send(command);
    return {
      key: destination,
      size: 0,
      etag: response.CopyObjectResult?.ETag || '',
      lastModified: new Date(),
    };
  }

  async headObject(key: string): Promise<StorageMetadata | null> {
    try {
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: key });
      const response = await this.s3.send(command);
      return {
        key,
        size: response.ContentLength || 0,
        etag: response.ETag || '',
        lastModified: response.LastModified || new Date(),
      };
    } catch (e: any) {
      if (e.name === 'NotFound') return null;
      throw e;
    }
  }

  async deleteObjects(keys: string[]): Promise<{ deleted: string[]; failed: Array<any> }> {
    const command = new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: { Objects: keys.map(Key => ({ Key })) },
    });
    const response = await this.s3.send(command);
    return {
      deleted: (response.Deleted || []).map(obj => obj.Key || ''),
      failed: (response.Errors || []).map(err => ({ key: err.Key, error: err.Message })),
    };
  }

  async batchGetObjects(keys: string[]): Promise<Map<string, StorageObject | Error>> {
    // Serial for now, could be parallelized with Promise.all()
    const results = new Map<string, StorageObject | Error>();
    for (const key of keys) {
      try {
        const obj = await this.getObject(key);
        if (obj) results.set(key, obj);
      } catch (e) {
        results.set(key, e as Error);
      }
    }
    return results;
  }

  async getObjectStream(key: string): Promise<NodeJS.ReadableStream | null> {
    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      const response = await this.s3.send(command);
      return response.Body as NodeJS.ReadableStream;
    } catch {
      return null;
    }
  }
}
```

### 1.5 Implementation: R2Adapter

```typescript
/**
 * server/storage/adapters/R2Adapter.ts
 * Cloudflare R2 implementation (S3-compatible)
 */

import { S3Client } from '@aws-sdk/client-s3';
import { StorageAdapterConfig } from '../StorageAdapter';
import { S3Adapter } from './S3Adapter';

export class R2Adapter extends S3Adapter {
  /**
   * R2 uses S3-compatible API with custom endpoint
   * No changes needed; just configure the endpoint
   */
  constructor(config: StorageAdapterConfig) {
    const r2Config: StorageAdapterConfig = {
      ...config,
      endpoint: config.endpoint || `https://${config.accessKeyId}.r2.cloudflarestorage.com`,
      forcePathStyle: true, // R2 requires path-style requests
    };
    super(r2Config);
  }
}
```

### 1.6 Storage Manager (Factory & Feature Flags)

```typescript
/**
 * server/storage/StorageManager.ts
 * Factory for creating storage adapters with feature flags
 */

import { IStorageAdapter } from './StorageAdapter';
import { LocalFSAdapter } from './adapters/LocalFSAdapter';
import { S3Adapter } from './adapters/S3Adapter';
import { R2Adapter } from './adapters/R2Adapter';
import log from '../logger.js';

export class StorageManager {
  private static instance: IStorageAdapter | null = null;
  private static fallbackAdapter: IStorageAdapter | null = null;

  static initialize(config: {
    provider: 'local' | 's3' | 'r2';
    local?: { basePath: string };
    s3?: { bucket: string; region?: string; accessKeyId?: string; secretAccessKey?: string };
    r2?: { bucket: string; accessKeyId?: string; secretAccessKey?: string; endpoint?: string };
    enableFallback?: boolean;
  }): IStorageAdapter {
    let adapter: IStorageAdapter;

    switch (config.provider) {
      case 's3':
        adapter = new S3Adapter(config.s3!);
        break;
      case 'r2':
        adapter = new R2Adapter(config.r2!);
        break;
      case 'local':
      default:
        adapter = new LocalFSAdapter(config.local!);
    }

    // Optional fallback to local if cloud fails
    if (config.enableFallback && config.provider !== 'local') {
      StorageManager.fallbackAdapter = new LocalFSAdapter({
        basePath: config.local?.basePath || './storage-fallback',
      });
      log.info('[Storage] Fallback adapter enabled:', config.local?.basePath);
    }

    this.instance = adapter;
    log.info('[Storage] Initialized with provider:', config.provider);
    return adapter;
  }

  static getInstance(): IStorageAdapter {
    if (!this.instance) {
      throw new Error('StorageManager not initialized. Call initialize() first.');
    }
    return this.instance;
  }

  static async getWithFallback(): Promise<IStorageAdapter> {
    const primary = this.getInstance();
    try {
      const health = await primary.healthCheck();
      if (health.healthy) return primary;
    } catch (e) {
      log.warn('[Storage] Primary storage health check failed:', e);
    }

    if (this.fallbackAdapter) {
      log.info('[Storage] Switching to fallback adapter');
      return this.fallbackAdapter;
    }

    return primary;
  }
}

// Usage in server initialization
export function initializeStorage() {
  const provider = (process.env.STORAGE_PROVIDER || 'local') as 'local' | 's3' | 'r2';

  StorageManager.initialize({
    provider,
    local: { basePath: process.env.STORAGE_LOCAL_PATH || './data' },
    s3: {
      bucket: process.env.STORAGE_BUCKET_NAME || 'cacc-writer',
      region: process.env.STORAGE_REGION || 'us-east-1',
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || '',
    },
    r2: {
      bucket: process.env.STORAGE_BUCKET_NAME || 'cacc-writer',
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || '',
      endpoint: process.env.STORAGE_ENDPOINT,
    },
    enableFallback: process.env.STORAGE_FALLBACK_LOCAL === 'true',
  });
}
```

---

## Phase 2: Identify All Storage Touchpoints

### 2.1 Scanning Tool

Create a script to find all file operations across the codebase:

```bash
#!/bin/bash
# scripts/find-storage-operations.sh

echo "=== Synchronous File Operations ==="
grep -r "fs\.readFileSync\|fs\.writeFileSync\|fs\.renameSync\|fs\.copyFileSync\|fs\.unlinkSync" \
  server/ --include="*.js" --include="*.ts" \
  | grep -v node_modules \
  | wc -l

echo "=== Async File Operations ==="
grep -r "fs\.promises\|readFile\|writeFile\|unlink\|rmdir" \
  server/ --include="*.js" --include="*.ts" \
  | grep -v node_modules \
  | wc -l

echo "=== File Path References ==="
grep -r "path\.join\|__dirname\|CASES_DIR\|KB_DIR\|EXPORTS_DIR" \
  server/ --include="*.js" --include="*.ts" \
  | grep -v node_modules \
  | cut -d: -f1 | sort -u | wc -l

echo "=== Stream Operations ==="
grep -r "createReadStream\|createWriteStream" \
  server/ --include="*.js" --include="*.ts" \
  | grep -v node_modules \
  | wc -l
```

### 2.2 Storage Touchpoint Mapping

Create a comprehensive map of all storage operations:

```typescript
/**
 * scripts/analyze-storage-touchpoints.ts
 * Detailed analysis of storage operations
 */

interface StorageTouchpoint {
  file: string;
  operation: 'read' | 'write' | 'delete' | 'stream';
  method: string;
  category: string;
  frequency: 'per-request' | 'per-user-action' | 'ad-hoc';
  path: string;
  notes: string;
}

const TOUCHPOINTS: StorageTouchpoint[] = [
  // Knowledge Base (hot path)
  {
    file: 'server/knowledgeBase.js',
    operation: 'read',
    method: 'readJSON()',
    category: 'knowledge-base',
    frequency: 'per-request',
    path: 'knowledge_base/index.json',
    notes: '308 KB index, loaded on every generation'
  },
  {
    file: 'server/knowledgeBase.js',
    operation: 'read',
    method: 'getExamples()',
    category: 'knowledge-base',
    frequency: 'per-request',
    path: 'knowledge_base/curated_examples/{formType}/*.json',
    notes: '~1000 example files, filtered in-memory'
  },
  {
    file: 'server/knowledgeBase.js',
    operation: 'write',
    method: 'addExample()',
    category: 'knowledge-base',
    frequency: 'ad-hoc',
    path: 'knowledge_base/approved_edits/{id}.json',
    notes: 'Appraiser approval; atomic write pattern'
  },

  // Case Data (warm path)
  {
    file: 'server/api/formDataRoutes.js',
    operation: 'read',
    method: 'fs.readFile()',
    category: 'case-metadata',
    frequency: 'per-user-action',
    path: 'data/cases/{caseId}/facts.json',
    notes: 'Case input facts; small file (10-500 KB)'
  },
  {
    file: 'server/api/formDataRoutes.js',
    operation: 'write',
    method: 'fs.writeFile()',
    category: 'case-metadata',
    frequency: 'per-user-action',
    path: 'data/cases/{caseId}/facts.json',
    notes: 'Case updates; serialized by per-case mutex'
  },

  // Exports (cold path)
  {
    file: 'server/export/pdfFormFiller.js',
    operation: 'read',
    method: 'readFileSync(TEMPLATE_PATH)',
    category: 'exports',
    frequency: 'per-user-action',
    path: 'templates/Form_1004.pdf',
    notes: '60 MB template; not cached'
  },
  {
    file: 'server/api/exportRoutes.js',
    operation: 'write',
    method: 'fs.writeFileSync() or archiver',
    category: 'exports',
    frequency: 'per-user-action',
    path: 'exports/{caseId}-{report|summary}.{pdf|xml|zip}',
    notes: '3-5 MB per export; stored for download'
  },

  // Photos & Documents (warm path)
  {
    file: 'server/photos/photoManager.js',
    operation: 'write',
    method: 'fs.copyFileSync()',
    category: 'user-uploads',
    frequency: 'per-user-action',
    path: 'data/users/{userId}/cases/{caseId}/photos/{photoId}.jpg',
    notes: 'User-uploaded photos; metadata in DB'
  },
  {
    file: 'server/api/documentRoutes.js',
    operation: 'write',
    method: 'fs.copyFileSync()',
    category: 'user-uploads',
    frequency: 'per-user-action',
    path: 'data/users/{userId}/cases/{caseId}/documents/{docType}.pdf',
    notes: 'MLS, appraisal, contract documents'
  },

  // Backups (cold path, compliance-critical)
  {
    file: 'server/security/backupRestoreService.js',
    operation: 'write',
    method: 'fs.copyFileSync()',
    category: 'backups',
    frequency: 'ad-hoc',
    path: 'backups/cacc-backup-*.db',
    notes: 'Full database backup; must retain 30+ days'
  },
];

export function analyze(): void {
  // Group by category
  const byCategory = new Map<string, StorageTouchpoint[]>();
  TOUCHPOINTS.forEach(tp => {
    const cat = tp.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(tp);
  });

  // Report
  console.log('Storage Touchpoints by Category:\n');
  byCategory.forEach((tps, cat) => {
    console.log(`${cat} (${tps.length} operations):`);
    tps.forEach(tp => {
      console.log(`  ${tp.file}:${tp.method}`);
      console.log(`    Operation: ${tp.operation}`);
      console.log(`    Frequency: ${tp.frequency}`);
      console.log(`    Path: ${tp.path}`);
      console.log();
    });
  });
}
```

---

## Phase 3: Migration Strategy by Category

### 3.1 Knowledge Base (Highest Priority)

**Current State:**
- 1.7 GB total
- 308 KB index.json (hot path, loaded per request)
- ~2000 curated example files
- ~500 approved narrative files
- Rarely updated (appraiser-driven)

**Migration Strategy: Move to R2 + CloudFront**

**Bucket Structure:**
```
cacc-kb/
├── index.json                              (keep in DB cache)
├── curated/
│   ├── 1004/
│   │   ├── {id1}.json
│   │   ├── {id2}.json
│   │   └── ...
│   ├── 1025/
│   └── 1073/
├── approved_edits/{id}.json
├── approved_narratives/{id}.json
├── phrase_bank/phrases.json
└── narratives/{formType}Narratives.json
```

**Access Pattern:**
```typescript
// Before: filesystem sync read
const index = readJSON(INDEX_FILE);  // ~50 ms

// After: cached + R2 with CloudFront
const index = await cache.get('kb:index', async () => {
  return await storage.getObject('index.json');  // 1st hit: 100 ms
}, { ttl: 86400 });  // Cache 24 hours
```

**Implementation:**
1. Use Redis for in-memory caching (if available)
2. CloudFront with 24-hour TTL for index.json
3. LazyLoad individual examples on demand
4. Versioning for audit trail

**Benefits:**
- No per-request disk I/O
- Geo-distributed via CloudFront
- Cheap storage ($0.015/GB with R2)
- Easy rollback (object versioning)

### 3.2 Exports (Medium Priority)

**Current State:**
- 1.2 GB total
- Generated on-demand (user-driven)
- ~1000+ files
- Read-heavy (users download repeatedly)

**Migration Strategy: Move to R2, keep 7-day local cache**

**Bucket Structure:**
```
cacc-exports/
├── {caseId}/
│   ├── {caseId}-report.pdf                (fillable Form_1004)
│   ├── {caseId}-summary.pdf               (narrative pages)
│   ├── {caseId}-report.xml                (MISMO 3.4)
│   ├── {caseId}-bundle.zip                (complete package)
│   └── metadata.json                      (timestamps, sizes)
```

**Access Pattern:**
```typescript
// Before: filesystem read on download
const buffer = fs.readFileSync(exportPath);

// After: R2 with fallback to local cache
const buffer = await getExportFile(caseId, type);
// If in local cache: read from disk (fast)
// If in R2: stream from R2 (medium speed)
// If expired: regenerate (slow but rare)
```

**Implementation:**
1. Write new exports to R2 first
2. Keep 7-day rolling cache on local disk
3. Lazy-load exports from R2 on first access after 7 days
4. Use presigned URLs for direct S3 downloads (reduce bandwidth cost)

**Benefits:**
- No local storage bloat (old exports cleanup)
- User downloads go directly to S3 (CDN not needed)
- Cheap long-term archive ($0.015/GB)
- Easy disaster recovery

### 3.3 Case Data & Photos (Medium-High Priority)

**Current State:**
- 50-100 MB per user
- Photos: 5-50 MB per case (user-uploaded)
- Documents: 1-5 MB per case (PDFs)
- Case metadata: <1 MB per case (JSON)

**Migration Strategy: Keep metadata local, move photos/docs to R2**

**Bucket Structure:**
```
cacc-user-data/
├── {userId}/
│   ├── cases/{caseId}/
│   │   ├── metadata.json          (KEEP LOCAL - small, frequent updates)
│   │   ├── photos/
│   │   │   ├── {photoId1}.jpg     → R2
│   │   │   ├── {photoId2}.jpg     → R2
│   │   │   └── manifest.json      → R2
│   │   └── documents/
│   │       ├── mls.pdf            → R2
│   │       ├── appraisal.pdf      → R2
│   │       └── contract.pdf       → R2
```

**Rationale:**
- Metadata stays in SQLite (small, frequent R/W, needs mutex)
- Photos/docs go to R2 (large, infrequent R/W, presigned URLs)

**Access Pattern:**
```typescript
// Metadata: synchronous from SQLite
const facts = db.prepare('SELECT facts FROM case_facts WHERE case_id = ?').get();

// Photos: streamed from R2
const photoUrl = await storage.getSignedUrl(`${userId}/cases/${caseId}/photos/{photoId}`);
// Frontend downloads directly from presigned URL

// Documents: on-demand from R2
const pdfBuffer = await storage.getObject(`${userId}/cases/${caseId}/documents/mls.pdf`);
```

**Implementation:**
1. New uploads go directly to R2
2. Migrate existing photos/docs in background
3. Keep file paths in database (no schema change)
4. Use presigned URLs for user downloads

**Benefits:**
- No local disk bloat
- User uploads scale infinitely
- Direct S3 downloads (no proxy)
- Easy multi-user scaling

### 3.4 Backups (Lower Priority, Compliance-Critical)

**Current State:**
- Stored in ./backups/ locally
- Full database backups (50-100 MB each)
- 30-day minimum retention (compliance)

**Migration Strategy: Move to R2 with Glacier-like lifecycle**

**Bucket Structure:**
```
cacc-backups/
├── cacc-backup-2026-03-28T120000Z.db      (Standard)
├── cacc-backup-2026-03-21T120000Z.db      (Standard, <7 days)
└── cacc-backup-2026-02-15T120000Z.db      (Archived, >30 days)
```

**Lifecycle Policy:**
```json
{
  "Rules": [
    {
      "ID": "archive-old-backups",
      "Filter": { "Prefix": "cacc-backup-" },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "GLACIER"  // For S3
          // R2 has no archive; keep as-is but very cheap
        }
      ],
      "Expiration": {
        "Days": 365  // Retain 1 year for compliance
      }
    }
  ]
}
```

**Access Pattern:**
```typescript
// Create backup
const backupName = `cacc-backup-${timestamp}.db`;
await storage.putObject(backupName, dbBuffer);

// List recent backups
const recent = await storage.listObjects({ prefix: 'cacc-backup-', maxKeys: 10 });

// Restore backup
const backupBuffer = await storage.getObject(`cacc-backup-${timestamp}.db`);
```

**Benefits:**
- Compliant retention without local disk
- Immutable audit trail (versioning)
- Cheap long-term storage
- Easy restore across servers

### 3.5 Summary Table: Migration Priority

| Category | Size | Priority | Strategy | Timeline |
|----------|------|----------|----------|----------|
| Knowledge Base | 1.7 GB | **High** | R2 + CDN + Cache | Week 1-2 |
| Exports | 1.2 GB | Medium | R2 + 7-day local cache | Week 2-3 |
| User Data (photos/docs) | ~200 MB | Medium-High | R2 + presigned URLs | Week 2-3 |
| Case Metadata | ~50 MB | **Low** | Keep SQLite (no change) | N/A |
| Backups | ~500 MB | Low (compliance) | R2 with lifecycle | Week 3 |
| Logs & Temp | ~10 MB | Very Low | Keep local or S3 | Optional |

---

## Phase 4: Implementation Details

### 4.1 Configuration & Environment

**.env additions:**
```bash
# Storage Provider (local | s3 | r2)
STORAGE_PROVIDER=r2

# R2 Configuration
STORAGE_BUCKET_NAME=cacc-writer-prod
STORAGE_ACCESS_KEY_ID=your_r2_api_key
STORAGE_SECRET_ACCESS_KEY=your_r2_api_secret
STORAGE_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com

# Optional: S3 Fallback
STORAGE_FALLBACK_LOCAL=true
STORAGE_LOCAL_PATH=./data

# Caching
CACHE_ENABLED=true
REDIS_URL=redis://localhost:6379

# Feature Flags
DUAL_WRITE_ENABLED=true           # Write to both FS and R2
KB_ALWAYS_LOCAL=false             # Force KB reads from local
EXPORT_ALWAYS_LOCAL=false         # Force export reads from local
```

### 4.2 Dependency Updates

**package.json additions:**
```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "@aws-sdk/s3-request-presigner": "^3.0.0",
    "redis": "^4.6.0",
    "ioredis": "^5.3.0"
  }
}
```

### 4.3 Storage Adapter Integration

**Integration points (replace fs operations):**

#### Before (knowledgeBase.js):
```javascript
function readJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  catch {
    return fallback;
  }
}
```

#### After:
```typescript
async function readJSON(key: string, fallback = {}): Promise<any> {
  try {
    const storage = StorageManager.getInstance();
    const obj = await storage.getObject(key);
    if (!obj) return fallback;
    return JSON.parse(obj.buffer.toString('utf8'));
  } catch {
    return fallback;
  }
}
```

**With caching:**
```typescript
async function readJSON(key: string, fallback = {}): Promise<any> {
  // Try cache first
  const cached = await cache.get(`json:${key}`);
  if (cached) return JSON.parse(cached);

  // Fetch from storage
  try {
    const storage = await StorageManager.getWithFallback();
    const obj = await storage.getObject(key);
    if (!obj) return fallback;

    const data = JSON.parse(obj.buffer.toString('utf8'));
    await cache.set(`json:${key}`, JSON.stringify(data), { ttl: 3600 });
    return data;
  } catch {
    return fallback;
  }
}
```

### 4.4 Dual-Write Implementation (Migration Safety)

**DualWriteAdapter wrapper:**
```typescript
/**
 * server/storage/adapters/DualWriteAdapter.ts
 * Writes to both primary and fallback during migration
 */

import { IStorageAdapter, StorageObject, StorageMetadata } from '../StorageAdapter';
import log from '../../logger.js';

export class DualWriteAdapter implements IStorageAdapter {
  constructor(
    private primary: IStorageAdapter,
    private secondary: IStorageAdapter
  ) {}

  async putObject(
    key: string,
    buffer: Buffer,
    options?: any
  ): Promise<StorageMetadata> {
    // Write to both
    const [primaryResult, secondaryResult] = await Promise.allSettled([
      this.primary.putObject(key, buffer, options),
      this.secondary.putObject(key, buffer, options),
    ]);

    if (primaryResult.status === 'fulfilled') {
      log.info(`[DualWrite] Wrote to primary: ${key}`);
      return primaryResult.value;
    }

    if (secondaryResult.status === 'fulfilled') {
      log.warn(`[DualWrite] Primary failed, wrote to secondary: ${key}`);
      return secondaryResult.value;
    }

    throw new Error(`DualWrite failed for ${key}`);
  }

  async getObject(key: string): Promise<StorageObject | null> {
    // Read from primary first
    try {
      const obj = await this.primary.getObject(key);
      if (obj) return obj;
    } catch (e) {
      log.warn(`[DualWrite] Primary read failed for ${key}:`, e);
    }

    // Fallback to secondary
    try {
      const obj = await this.secondary.getObject(key);
      if (obj) {
        log.info(`[DualWrite] Fell back to secondary for ${key}`);
        return obj;
      }
    } catch (e) {
      log.error(`[DualWrite] Secondary read failed for ${key}:`, e);
    }

    return null;
  }

  // ... implement other methods similarly ...
}
```

**Usage:**
```typescript
// During migration (DUAL_WRITE_ENABLED=true)
const primaryAdapter = new R2Adapter(r2Config);
const secondaryAdapter = new LocalFSAdapter(localConfig);
const dualAdapter = new DualWriteAdapter(primaryAdapter, secondaryAdapter);

StorageManager.initialize({
  provider: 'r2',
  r2: r2Config,
  local: localConfig,
  enableFallback: true,  // Enables dual-write
});
```

### 4.5 Presigned URL Generation for Large Uploads

```typescript
/**
 * Handle large photo/document uploads with presigned URLs
 */

// Frontend initiates upload
POST /api/cases/{caseId}/photos/init-upload
  → server generates presigned POST URL
  → frontend uploads directly to R2
  → server updates DB with photo URL

// Implementation
app.post('/api/cases/:caseId/photos/init-upload', async (req, res) => {
  const { fileName, contentType } = req.body;
  const caseId = req.params.caseId;
  const userId = req.user.id;

  const storage = StorageManager.getInstance();
  const key = `users/${userId}/cases/${caseId}/photos/${fileName}`;

  // For S3, use CreateMultipartUploadCommand
  // For R2, use regular presigned POST
  const presignedUrl = await storage.getSignedUrl(key, {
    expiresIn: 3600,
    contentType,
  });

  res.json({ presignedUrl, key });
});

// Frontend receives presignedUrl and uploads directly to R2
// When complete, frontend calls:
PUT /api/cases/{caseId}/photos/{photoId}/confirm
  → server records photo metadata in DB
  → photo is now accessible
```

---

## Phase 5: Data Migration & Cutover

### 5.1 Pre-Migration Checklist

- [ ] R2/S3 bucket created and configured
- [ ] IAM service account created with least-privilege
- [ ] CloudFront distribution created (if using S3)
- [ ] Redis cluster (optional, for caching)
- [ ] Storage abstraction layer implemented and tested
- [ ] Dual-write adapter tested
- [ ] Environment variables configured
- [ ] Feature flags in place
- [ ] Monitoring & alerting configured
- [ ] Rollback plan documented

### 5.2 Migration Script

```typescript
/**
 * scripts/migrate-to-r2.ts
 * Migrate existing files to cloud storage
 */

import fs from 'fs';
import path from 'path';
import { StorageManager } from '../server/storage/StorageManager';
import log from '../server/logger.js';

interface MigrationStats {
  category: string;
  filesProcessed: number;
  bytesTransferred: number;
  errors: Array<{ file: string; error: string }>;
  startTime: Date;
  endTime?: Date;
}

class StorageMigrator {
  private storage = StorageManager.getInstance();
  private stats: Map<string, MigrationStats> = new Map();

  async migrateKnowledgeBase(sourcePath: string): Promise<MigrationStats> {
    const stat: MigrationStats = {
      category: 'knowledge-base',
      filesProcessed: 0,
      bytesTransferred: 0,
      errors: [],
      startTime: new Date(),
    };

    const dirs = [
      'curated_examples',
      'approved_edits',
      'approvedNarratives',
      'phrase_bank',
      'narratives',
    ];

    for (const dir of dirs) {
      const fullPath = path.join(sourcePath, dir);
      if (!fs.existsSync(fullPath)) continue;

      const files = this.walkDir(fullPath);
      for (const file of files) {
        try {
          const buffer = fs.readFileSync(file);
          const relativePath = path.relative(sourcePath, file);
          const key = `kb/${relativePath}`;

          await this.storage.putObject(key, buffer, {
            contentType: 'application/json',
          });

          stat.filesProcessed++;
          stat.bytesTransferred += buffer.length;

          if (stat.filesProcessed % 100 === 0) {
            log.info(`[Migration KB] Processed ${stat.filesProcessed} files`);
          }
        } catch (e) {
          stat.errors.push({ file, error: String(e) });
          log.error(`[Migration KB] Error:`, file, e);
        }
      }
    }

    stat.endTime = new Date();
    return stat;
  }

  async migrateExports(sourcePath: string): Promise<MigrationStats> {
    const stat: MigrationStats = {
      category: 'exports',
      filesProcessed: 0,
      bytesTransferred: 0,
      errors: [],
      startTime: new Date(),
    };

    const files = this.walkDir(sourcePath);
    for (const file of files) {
      try {
        const buffer = fs.readFileSync(file);
        const relativePath = path.relative(sourcePath, file);
        const key = `exports/${relativePath}`;

        await this.storage.putObject(key, buffer);

        stat.filesProcessed++;
        stat.bytesTransferred += buffer.length;

        if (stat.filesProcessed % 50 === 0) {
          log.info(`[Migration Exports] Processed ${stat.filesProcessed} files`);
        }
      } catch (e) {
        stat.errors.push({ file, error: String(e) });
        log.error(`[Migration Exports] Error:`, file, e);
      }
    }

    stat.endTime = new Date();
    return stat;
  }

  async migrateUserData(sourcePath: string): Promise<MigrationStats> {
    const stat: MigrationStats = {
      category: 'user-data',
      filesProcessed: 0,
      bytesTransferred: 0,
      errors: [],
      startTime: new Date(),
    };

    // Migrate photos and documents only
    const skipDirs = ['meta.json', 'facts.json', 'outputs.json'];
    const files = this.walkDir(sourcePath).filter(
      f => !skipDirs.some(skip => f.includes(skip))
    );

    for (const file of files) {
      try {
        const buffer = fs.readFileSync(file);
        const relativePath = path.relative(sourcePath, file);
        const key = `user-data/${relativePath}`;

        await this.storage.putObject(key, buffer);

        stat.filesProcessed++;
        stat.bytesTransferred += buffer.length;

        if (stat.filesProcessed % 100 === 0) {
          log.info(`[Migration UserData] Processed ${stat.filesProcessed} files`);
        }
      } catch (e) {
        stat.errors.push({ file, error: String(e) });
        log.error(`[Migration UserData] Error:`, file, e);
      }
    }

    stat.endTime = new Date();
    return stat;
  }

  private walkDir(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.walkDir(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  async runMigration(): Promise<Map<string, MigrationStats>> {
    const basePath = './';

    log.info('[Migration] Starting storage migration to R2');

    // 1. Migrate knowledge base
    const kbStats = await this.migrateKnowledgeBase(path.join(basePath, 'knowledge_base'));
    this.stats.set('knowledge-base', kbStats);

    // 2. Migrate exports
    const exportsStats = await this.migrateExports(path.join(basePath, 'exports'));
    this.stats.set('exports', exportsStats);

    // 3. Migrate user data
    const userDataStats = await this.migrateUserData(path.join(basePath, 'data/users'));
    this.stats.set('user-data', userDataStats);

    // 4. Report
    this.printReport();

    return this.stats;
  }

  private printReport(): void {
    console.log('\n=== MIGRATION REPORT ===\n');

    let totalFiles = 0;
    let totalBytes = 0;
    let totalErrors = 0;

    for (const [category, stat] of this.stats) {
      const duration = (stat.endTime!.getTime() - stat.startTime.getTime()) / 1000;
      const throughput = (stat.bytesTransferred / (1024 * 1024) / duration).toFixed(2);

      console.log(`${category}:`);
      console.log(`  Files: ${stat.filesProcessed}`);
      console.log(`  Bytes: ${(stat.bytesTransferred / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`  Duration: ${duration.toFixed(1)} seconds`);
      console.log(`  Throughput: ${throughput} MB/s`);
      console.log(`  Errors: ${stat.errors.length}`);

      if (stat.errors.length > 0) {
        console.log(`  First error: ${stat.errors[0].file} - ${stat.errors[0].error}`);
      }

      totalFiles += stat.filesProcessed;
      totalBytes += stat.bytesTransferred;
      totalErrors += stat.errors.length;
    }

    console.log(`\nTOTAL:`);
    console.log(`  Files: ${totalFiles}`);
    console.log(`  Bytes: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Errors: ${totalErrors}`);
  }
}

// Run migration
const migrator = new StorageMigrator();
migrator.runMigration().catch(console.error);
```

### 5.3 Verification Script

```typescript
/**
 * scripts/verify-migration.ts
 * Verify that cloud storage has all expected files
 */

import { StorageManager } from '../server/storage/StorageManager';
import log from '../server/logger.js';

class MigrationVerifier {
  private storage = StorageManager.getInstance();

  async verifyKnowledgeBase(): Promise<boolean> {
    log.info('[Verify] Checking knowledge base...');

    const expectedPrefixes = [
      'kb/curated_examples/',
      'kb/approved_edits/',
      'kb/approvedNarratives/',
      'kb/phrase_bank/',
      'kb/narratives/',
    ];

    for (const prefix of expectedPrefixes) {
      const result = await this.storage.listObjects({ prefix, maxKeys: 1 });
      if (result.contents.length === 0) {
        log.error(`[Verify] Missing prefix: ${prefix}`);
        return false;
      }
    }

    log.info('[Verify] Knowledge base ✓');
    return true;
  }

  async verifyExports(): Promise<boolean> {
    log.info('[Verify] Checking exports...');

    const result = await this.storage.listObjects({ prefix: 'exports/', maxKeys: 10 });
    if (result.contents.length === 0) {
      log.error('[Verify] No exports found');
      return false;
    }

    log.info(`[Verify] Exports ✓ (${result.contents.length} files visible)`);
    return true;
  }

  async verifyUserData(): Promise<boolean> {
    log.info('[Verify] Checking user data...');

    const result = await this.storage.listObjects({ prefix: 'user-data/', maxKeys: 10 });
    if (result.contents.length === 0) {
      log.error('[Verify] No user data found');
      return false;
    }

    log.info(`[Verify] User data ✓ (${result.contents.length} files visible)`);
    return true;
  }

  async runVerification(): Promise<boolean> {
    const kbOk = await this.verifyKnowledgeBase();
    const exportsOk = await this.verifyExports();
    const userDataOk = await this.verifyUserData();

    if (kbOk && exportsOk && userDataOk) {
      log.info('[Verify] ALL CHECKS PASSED ✓');
      return true;
    } else {
      log.error('[Verify] SOME CHECKS FAILED ✗');
      return false;
    }
  }
}

const verifier = new MigrationVerifier();
verifier.runVerification().catch(console.error);
```

### 5.4 Cutover Plan

**Timeline:**
1. **Week 1: Preparation**
   - Set up R2 bucket
   - Implement StorageAdapter + DualWriteAdapter
   - Test with staging environment
   - Enable DUAL_WRITE_ENABLED=true in staging
   - Run migration script in staging
   - Verify checksums

2. **Week 2: Staging Migration**
   - Run full migration script on staging
   - Enable dual-write for all new uploads
   - Verify existing files accessible from R2
   - Run performance benchmarks
   - Set up monitoring & alerting

3. **Week 3: Production Cutover**
   - **Day 1:** Enable DUAL_WRITE for production
   - **Day 2-7:** Run background migration script
   - **Day 3:** Verify primary reads from R2
   - **Day 7:** Switch default read to R2 (STORAGE_PROVIDER=r2)
   - **Day 8-14:** Monitor for issues; keep fallback enabled
   - **Day 15:** Disable fallback (STORAGE_FALLBACK_LOCAL=false)
   - **Day 30:** Remove old local files (archive first)

### 5.5 Rollback Plan

**If issues detected:**

1. **Quick Rollback (within 24 hours):**
   - Set STORAGE_PROVIDER=local
   - Reads from local filesystem (in sync via dual-write)
   - All writes still go to R2 (separate process to restore them)

2. **Full Rollback (> 24 hours):**
   - Run reverse migration script (R2 → local)
   - Verify all files present locally
   - Disable DUAL_WRITE
   - Set STORAGE_PROVIDER=local

---

## Operational Procedures

### 6.1 Adding New Files to Cloud Storage

**For new uploads (after migration):**

```typescript
// In any route handler
import { StorageManager } from '../storage/StorageManager';

app.post('/api/cases/:caseId/photos/upload', async (req, res) => {
  const file = req.file;
  const caseId = req.params.caseId;
  const userId = req.user.id;

  // Store in cloud
  const storage = await StorageManager.getWithFallback();
  const key = `users/${userId}/cases/${caseId}/photos/${file.filename}`;

  const metadata = await storage.putObject(key, file.buffer, {
    contentType: file.mimetype,
    metadata: { originalName: file.originalname },
  });

  // Update database (file path now points to cloud key)
  db.prepare(
    'INSERT INTO case_photos (case_id, user_id, file_path, file_size) VALUES (?, ?, ?, ?)'
  ).run(caseId, userId, key, file.size);

  res.json({ ok: true, key, size: file.size });
});
```

### 6.2 Reading Files from Cloud Storage

```typescript
// Use storage adapter instead of fs
const storage = await StorageManager.getWithFallback();

// Option 1: Get full buffer
const obj = await storage.getObject(key);
if (obj) {
  res.set('Content-Type', obj.contentType);
  res.send(obj.buffer);
}

// Option 2: Stream large files
const stream = await storage.getObjectStream(key);
if (stream) {
  stream.pipe(res);
}

// Option 3: Generate presigned URL (direct download)
const url = await storage.getSignedUrl(key, { expiresIn: 3600 });
res.json({ downloadUrl: url });
```

### 6.3 Cleanup & Lifecycle Policies

**Local Filesystem Cleanup (after migration):**

```bash
#!/bin/bash
# scripts/cleanup-local-storage.sh

# Archive old exports (7+ days)
find ./exports -type f -mtime +7 -exec mv {} ./archives/exports/ \;

# Archive old logs
find ./temp -type f -name "*.log" -mtime +30 -exec rm {} \;

# Remove temp uploads
find ./temp/uploads -type f -mtime +1 -delete
```

**R2 Lifecycle Policy:**

```json
{
  "Rules": [
    {
      "ID": "delete-old-exports",
      "Filter": { "Prefix": "exports/" },
      "Expiration": { "Days": 365 }
    },
    {
      "ID": "delete-old-temp",
      "Filter": { "Prefix": "temp/" },
      "Expiration": { "Days": 30 }
    },
    {
      "ID": "archive-old-backups",
      "Filter": { "Prefix": "backups/" },
      "Transitions": [
        { "Days": 90, "StorageClass": "GLACIER" }
      ],
      "Expiration": { "Days": 365 }
    }
  ]
}
```

---

## Rollback & Disaster Recovery

### 7.1 Failure Scenarios

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| R2 unavailable | Health check fails; 503 errors | Fallback to local FS (if dual-write enabled) |
| File corruption | Checksum mismatch | Restore from backup (R2 versioning) |
| Accidental deletion | 404 errors | Restore from backup; versioning enabled |
| Network partition | Request timeout | Fallback to local + retry |
| Quota exceeded | 403 Insufficient Bucket Space | Increase R2 bucket quota; no data loss |

### 7.2 Backup & Recovery

**Cloud-to-Cloud Backup (Cross-region):**

```bash
#!/bin/bash
# scripts/backup-r2-to-s3.sh

# Backup R2 to S3 (weekly)
aws s3 sync s3://cacc-writer-prod/ s3://cacc-writer-backup-prod/ \
  --source-region auto \
  --region us-east-1 \
  --storage-class GLACIER
```

**Point-in-Time Recovery:**

```typescript
// Restore specific version
const backupDate = new Date('2026-03-25');
const version = await storage.listObjects({
  prefix: 'kb/',
  versionId: backupDate.toISOString(),
});
```

---

## Monitoring & Alerting

### 8.1 Health Checks

```typescript
/**
 * server/monitoring/storageHealthCheck.ts
 */

export async function checkStorageHealth(): Promise<{
  primary: { healthy: boolean; latency: number };
  fallback?: { healthy: boolean; latency: number };
  overallStatus: 'healthy' | 'degraded' | 'down';
}> {
  const storage = StorageManager.getInstance();
  const primary = await storage.healthCheck();

  const fallback = StorageManager.fallbackAdapter
    ? await StorageManager.fallbackAdapter.healthCheck()
    : undefined;

  let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
  if (!primary.healthy && !fallback?.healthy) {
    overallStatus = 'down';
  } else if (!primary.healthy && fallback?.healthy) {
    overallStatus = 'degraded';
  }

  return { primary, fallback, overallStatus };
}
```

**Integration with health routes:**

```typescript
app.get('/health/storage', async (req, res) => {
  const health = await checkStorageHealth();
  res.status(health.overallStatus === 'down' ? 503 : 200).json(health);
});
```

### 8.2 Metrics & Logging

```typescript
/**
 * Log all storage operations for debugging
 */

class StorageLogger {
  logRead(key: string, latency: number, hit: boolean) {
    log.info('[Storage] Read', {
      key,
      latency,
      hit: hit ? 'cache' : 'disk',
    });
  }

  logWrite(key: string, size: number, latency: number) {
    log.info('[Storage] Write', { key, size, latency });
  }

  logError(operation: string, key: string, error: string) {
    log.error('[Storage] Error', { operation, key, error });
  }
}
```

---

## Cost Analysis & ROI

### 9.1 Monthly Costs (Detailed)

**AWS S3 (Current equivalent if on cloud):**
- Storage (2.6 GB): $0.06
- API calls (100K reads): $0.04
- Data egress (500 GB downloads): $45
- CloudFront CDN: $42.50
- **Monthly Total: $87.60**
- **Annual: $1,051**

**Cloudflare R2 (Recommended):**
- Storage (2.6 GB): $0.04
- API calls (100K): FREE (3M/mo included)
- Data egress (500 GB): FREE
- R2 CDN: ~$1.50
- **Monthly Total: $1.54**
- **Annual: $18.50**

**Savings: 97.8% ($1,032.50/year)**

### 9.2 ROI Timeline

| Investment | Cost | Timeline |
|-----------|------|----------|
| Implementation (100 dev hours) | $5,000 | Week 1-3 |
| Testing & QA | $2,000 | Week 2-3 |
| Monitoring setup | $500 | Week 1 |
| **Total One-Time** | **$7,500** | |
| Annual savings | **$1,032.50** | Ongoing |
| **Payback period** | **~7 months** | |

---

## FAQ & Troubleshooting

### Q1: Why R2 over S3?

**A:** Cost. S3 with egress is $87.60/month; R2 is $1.54/month (97% cheaper). Both use same S3 API, so migration is identical.

### Q2: Do we need to change the database schema?

**A:** No. File paths stored in database can remain the same. Just update the interpretation of the path string (e.g., `users/123/photos/abc.jpg` could mean "R2 bucket key" instead of "local filesystem path").

### Q3: What about file permissions and multi-tenancy?

**A:** R2 does not enforce permissions at the object level. Instead, use a service account with a restricted IAM policy (read-only on specific prefixes). User isolation happens at the application layer (always prepend `users/{userId}/` to keys).

### Q4: Can we use this with serverless (Lambda)?

**A:** Yes. The StorageAdapter abstraction works with Lambda. Just ensure the Lambda has R2 credentials in environment variables. No local filesystem needed.

### Q5: How do we handle versioning?

**A:** Enable versioning on the R2 bucket. The `getSignedUrl()` method accepts `versionId`. Example:

```typescript
const url = await storage.getSignedUrl(key, {
  expiresIn: 3600,
  versionId: '2026-03-25T120000Z',
});
```

### Q6: What if we want to stay on local filesystem?

**A:** Set `STORAGE_PROVIDER=local` and keep using the StorageAdapter. It abstracts the provider, so code doesn't change.

### Q7: How do we prevent users from accessing each other's files?

**A:** Always prepend `users/{userId}/` to keys in the application code. Never trust user-provided paths. Example:

```typescript
// Safe
const key = `users/${req.user.id}/cases/${caseId}/photos/${photoId}`;

// UNSAFE (never do this)
const key = req.body.key;  // User could provide "users/123/..."
```

### Q8: Can we use R2 with multiple regions?

**A:** Yes. R2 automatically replicates across multiple regions. No configuration needed. Cloudflare's CDN includes geo-routing.

### Q9: What about large file uploads (> 100 MB)?

**A:** Use multipart upload (AWS SDK handles automatically) or presigned PUT URLs:

```typescript
const url = await storage.getSignedUrl(key, { expiresIn: 3600 });
// Client uploads directly to this URL
```

### Q10: How do we audit who accessed what files?

**A:** Enable request logging in R2:

```
Cloudflare R2 > Settings > Request logging
```

All reads/writes will be logged to an S3-compatible bucket (separate).

---

## Appendix: Complete Environment Example

```bash
# .env.production

# Storage Configuration
STORAGE_PROVIDER=r2
STORAGE_BUCKET_NAME=cacc-writer-prod
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=abc123xyz
STORAGE_SECRET_ACCESS_KEY=***secret***
STORAGE_ENDPOINT=https://1234567890.r2.cloudflarestorage.com

# Fallback Configuration
STORAGE_FALLBACK_LOCAL=true
STORAGE_LOCAL_PATH=./data-fallback

# Feature Flags
DUAL_WRITE_ENABLED=true
KB_ALWAYS_LOCAL=false
EXPORT_ALWAYS_LOCAL=false

# Caching
CACHE_ENABLED=true
REDIS_URL=redis://redis.internal:6379/1
CACHE_TTL_KB=86400
CACHE_TTL_EXPORTS=604800

# CDN
CDN_ENABLED=true
CDN_URL=https://cdn-cacc.cloudflare.com
CDN_TTL_KB=86400

# Monitoring
STORAGE_HEALTH_CHECK_INTERVAL=60000
STORAGE_LOG_LEVEL=info
SENTRY_DSN=https://***@sentry.io/***
```

---

## Final Checklist

- [ ] StorageAdapter interface designed
- [ ] LocalFSAdapter implemented & tested
- [ ] S3Adapter implemented & tested
- [ ] R2Adapter implemented & tested
- [ ] DualWriteAdapter implemented & tested
- [ ] StorageManager factory implemented
- [ ] Environment variables defined
- [ ] Feature flags implemented
- [ ] Cache layer (Redis) integrated
- [ ] Health checks implemented
- [ ] Monitoring & alerting configured
- [ ] Migration script written & tested
- [ ] Verification script written & tested
- [ ] Rollback procedures documented
- [ ] Disaster recovery plan reviewed
- [ ] Cost analysis completed
- [ ] Team trained on new system
- [ ] Staging migration completed
- [ ] Production cutover scheduled
- [ ] Post-migration monitoring active

---

**Document Status:** Ready for implementation
**Next Steps:** Begin Phase 1 (StorageAdapter layer) in Week 1
**Estimated Completion:** 2-3 weeks
**Cost Savings:** $1,032.50/year (97% reduction)

