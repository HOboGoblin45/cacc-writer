# Storage Module

Abstract storage layer for CACC Writer supporting local filesystem, AWS S3, and Cloudflare R2.

## Overview

This module provides a unified `StorageAdapter` interface enabling seamless migration from local filesystem to cloud storage without code changes.

## Files

### Core Adapters

- **StorageAdapter.js** (128 lines)
  - Abstract base class defining the unified interface
  - All methods must be implemented by concrete adapters
  - Comprehensive JSDoc for all methods

- **LocalStorageAdapter.js** (298 lines)
  - Node.js filesystem implementation
  - Atomic writes using temp file + rename pattern
  - Automatic directory creation
  - Content-type inference from file extensions

- **R2StorageAdapter.js** (387 lines)
  - Cloudflare R2 implementation
  - S3-compatible API using AWS SDK
  - Pre-signed HTTPS URLs
  - Zero egress fees (vs $0.09/GB for S3)

- **S3StorageAdapter.js** (380 lines)
  - Amazon S3 implementation
  - Standard AWS endpoints
  - Full IAM/ACL support
  - Higher cost than R2

- **DualWriteAdapter.js** (310 lines)
  - Wraps two adapters for zero-downtime migration
  - Writes to both primary and secondary
  - Reads from primary with secondary fallback
  - Backfill from secondary to primary on read

### Factory & Export

- **StorageFactory.js** (151 lines)
  - Factory function: `createStorageAdapter(config)`
  - Singleton: `getStorageAdapter()`
  - Provider selection via `STORAGE_PROVIDER` env var
  - Graceful fallback to local storage

- **index.js** (17 lines)
  - Barrel export for clean imports
  - Re-exports all adapters and factory functions

## Quick Start

### Installation

```bash
# Install AWS SDK (required for S3/R2)
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Basic Usage

```javascript
import { getStorageAdapter } from '../storage/index.js';

const storage = getStorageAdapter();

// Store file
await storage.put('file.txt', Buffer.from('Hello'));

// Retrieve file
const data = await storage.get('file.txt');

// Check existence
const exists = await storage.exists('file.txt');

// List files
const files = await storage.list('prefix/');

// Delete file
await storage.delete('file.txt');
```

### Configuration

**Environment variables:**

```bash
# Local filesystem (default)
STORAGE_PROVIDER=local
STORAGE_BASE_PATH=./data

# Cloudflare R2
STORAGE_PROVIDER=r2
R2_BUCKET=cacc-writer-prod
R2_ACCOUNT_ID=abc123xyz
R2_ACCESS_KEY_ID=key-id
R2_SECRET_ACCESS_KEY=secret

# AWS S3
STORAGE_PROVIDER=s3
S3_BUCKET=cacc-writer-prod
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=key-id
AWS_SECRET_ACCESS_KEY=secret

# Dual-write (for migration)
STORAGE_PROVIDER=dual
STORAGE_PRIMARY_PROVIDER=r2
STORAGE_SECONDARY_PROVIDER=local
```

## API Reference

All adapters implement these async methods:

```javascript
// Store file (creates parent dirs automatically)
async put(key, data, options = {})
// data: Buffer or string
// options: { contentType, metadata }

// Retrieve file (returns null if not found)
async get(key)

// Delete file (no error if missing)
async delete(key)

// Check if file exists
async exists(key)

// List files with prefix filter
async list(prefix = '')
// Returns: [{ key, size, lastModified }, ...]

// Generate pre-signed URL (expires in seconds)
async getSignedUrl(key, expiresIn = 3600)

// Copy file from source to destination
async copy(srcKey, destKey)

// Get file metadata (size, type, modified time)
async getMetadata(key)
// Returns: { size, lastModified, contentType } or null

// Get provider name identifier
getProviderName()
// Returns: 'local', 's3', 'r2', or 'dual'
```

## Supported Providers

| Provider | Status | Cost | Latency | Egress | Setup |
|----------|--------|------|---------|--------|-------|
| Local | ✓ Default | Free | ~10ms | N/A | Instant |
| R2 | ✓ Recommended | $0.015/GB | ~100ms | Free | 30 min |
| S3 | ✓ Available | $0.023/GB | ~100ms | $0.09/GB | 2 hours |

## Migration Guide

### Phase 1: Dual-Write (1-2 weeks)

```bash
export STORAGE_PROVIDER=dual
export STORAGE_PRIMARY_PROVIDER=r2
export STORAGE_SECONDARY_PROVIDER=local
export R2_BUCKET=cacc-writer-prod
export R2_ACCOUNT_ID=abc123xyz
export R2_ACCESS_KEY_ID=key-id
export R2_SECRET_ACCESS_KEY=secret
```

**Behavior:**
- Writes: to R2 (primary) + local (secondary)
- Reads: from R2; fallback to local if missing
- Backfill: from local to R2 automatically

### Phase 2: R2-Only (After verification)

```bash
export STORAGE_PROVIDER=r2
export R2_BUCKET=cacc-writer-prod
export R2_ACCOUNT_ID=abc123xyz
export R2_ACCESS_KEY_ID=key-id
export R2_SECRET_ACCESS_KEY=secret
```

**Behavior:**
- All reads and writes to R2
- Keep local filesystem as backup (optional)

## Migration Script

Migrate files from source to target storage:

```bash
# Dry-run (preview, no changes)
node scripts/migrate_storage.mjs \
  --source=local \
  --target=r2 \
  --prefix=knowledge_base/ \
  --dry-run

# Actual migration
node scripts/migrate_storage.mjs \
  --source=local \
  --target=r2 \
  --prefix=knowledge_base/

# Resume (skips already-migrated files)
node scripts/migrate_storage.mjs \
  --source=local \
  --target=r2 \
  --prefix=exports/
```

**Features:**
- Dry-run mode for safety
- Prefix-based filtering
- Resume capability (tracks state)
- Integrity verification (compares sizes)
- Progress logging and summary

## Testing

Comprehensive test suite using Vitest:

```bash
npm test -- storageAdapter.test.mjs
```

**Coverage:**
- StorageAdapter abstract class
- LocalStorageAdapter (all methods)
- DualWriteAdapter (dual-write behavior)
- StorageFactory (adapter creation, singleton)
- Error handling and edge cases

**Features:**
- Uses temporary directories (no cloud credentials needed)
- Async/await patterns
- ~20 test cases covering all methods

## Error Handling

**Operations return values:**
- `get()` returns `null` for missing files (not error)
- `delete()` succeeds even if file doesn't exist
- `exists()` returns boolean (no errors)

**Operations throw errors:**
- `put()` - on write failure
- `list()` - on read failure
- `getMetadata()` - on access failure
- Cloud adapters handle `NoSuchKey` exception specially

**DualWriteAdapter:**
- Primary failures are fatal (throws immediately)
- Secondary failures are non-fatal (logged, not thrown)

## Performance

### Latency

| Operation | Local | R2 | S3 | CDN Cache |
|-----------|-------|-----|-----|-----------|
| get() | 10-50ms | 100-200ms | 100-200ms | 5-20ms |
| put() | 5-10ms | 50-150ms | 50-150ms | N/A |
| list() | 10-50ms | 100-500ms | 100-500ms | N/A |

### Throughput

- Local: Limited by disk I/O (~100-500 MB/s)
- R2/S3: Virtually unlimited (shared infrastructure)

## Cost Analysis (Monthly)

**Baseline: 2.6 GB storage, 30K reads, 500 GB egress**

| Provider | Storage | API | Egress | CDN | Total |
|----------|---------|-----|--------|-----|-------|
| S3 only | $0.06 | $0.01 | $45.00 | — | $45.07 |
| S3 + CloudFront | $0.06 | $0.01 | $0.00 | $42.50 | $42.57 |
| R2 | $0.04 | $0.00 | $0.00 | $1.50 | **$1.54** |

**R2 saves 97% vs S3 + CloudFront**

## Security

### Authentication

- **Local**: Filesystem permissions (0700 on dirs)
- **R2/S3**: IAM service account (least-privilege)
- **Credentials**: Via environment variables (never hardcoded)

### Data Protection

- **At-rest**: SSE-S3 (S3) or AES-128 (R2)
- **In-transit**: TLS 1.2+ HTTPS
- **Isolation**: Path-based (enforce at app layer)

## Common Patterns

### Atomic JSON Updates

```javascript
async function updateJSON(key, updateFn) {
  const storage = getStorageAdapter();
  const current = await storage.get(key);
  const data = current ? JSON.parse(current) : {};
  const updated = updateFn(data);
  await storage.put(key, JSON.stringify(updated, null, 2));
}
```

### Pre-Signed URLs for Downloads

```javascript
const url = await storage.getSignedUrl('exports/report.pdf', 3600);
// Returns HTTPS URL with 1-hour expiry (or file:// for local)
```

### Batch Operations

```javascript
const files = await storage.list('knowledge_base/');
for (const file of files) {
  const data = await storage.get(file.key);
  // Process...
}
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| "AWS SDK not available" | `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` |
| "Missing required config" | Check all env vars are set for chosen provider |
| "NoCredentialsError" | Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY |
| "DualWriteAdapter: put (secondary) failed" | Normal during migration; primary succeeded |

## Documentation

- **Full Implementation Guide**: `docs/STORAGE_ADAPTER_IMPLEMENTATION.md`
- **Quick Start**: `docs/STORAGE_ADAPTER_QUICK_START.md`
- **Migration Plan**: `docs/migration/S3_R2_MIGRATION_PLAN.md`
- **Storage Audit**: `docs/migration/STORAGE_RESEARCH_FINDINGS.md`

## Next Steps

1. Install AWS SDK: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
2. Run tests: `npm test -- storageAdapter.test.mjs`
3. Identify file I/O touchpoints in codebase
4. Start migration with low-risk areas (exports, backups)
5. Deploy dual-write mode for 2-4 week testing period
6. Verify all files migrated correctly
7. Switch to single-provider mode for production

---

**Module Version:** 1.0
**Status:** Ready for Integration
**Date:** March 28, 2026
