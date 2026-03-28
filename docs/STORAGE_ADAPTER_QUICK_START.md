# Storage Adapter - Quick Start Guide

## Installation

```bash
# Install AWS SDK (required for S3/R2)
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Run tests
npm test -- storageAdapter.test.mjs
```

## Basic Usage

### Default (Local Filesystem)

```javascript
import { getStorageAdapter } from '../storage/index.js';

const storage = getStorageAdapter();
await storage.put('file.txt', Buffer.from('Hello'));
const data = await storage.get('file.txt');
await storage.delete('file.txt');
```

### Configuration via Environment Variables

```bash
# Local storage (default)
STORAGE_PROVIDER=local
STORAGE_BASE_PATH=./data

# Cloudflare R2
STORAGE_PROVIDER=r2
R2_BUCKET=my-bucket
R2_ACCOUNT_ID=abc123xyz
R2_ACCESS_KEY_ID=key
R2_SECRET_ACCESS_KEY=secret

# AWS S3
STORAGE_PROVIDER=s3
S3_BUCKET=my-bucket
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=key
AWS_SECRET_ACCESS_KEY=secret

# Dual-write (migration mode)
STORAGE_PROVIDER=dual
STORAGE_PRIMARY_PROVIDER=r2
STORAGE_SECONDARY_PROVIDER=local
```

## Common Operations

### Store a File

```javascript
const storage = getStorageAdapter();

await storage.put('exports/report.pdf', pdfBuffer, {
  contentType: 'application/pdf',
  metadata: { caseId: '123', type: 'report' }
});
```

### Retrieve a File

```javascript
const data = await storage.get('exports/report.pdf');
if (!data) {
  console.log('File not found');
} else {
  console.log('File size:', data.length);
}
```

### Check if File Exists

```javascript
const exists = await storage.exists('exports/report.pdf');
if (!exists) {
  console.log('File not found');
}
```

### List Files

```javascript
const files = await storage.list('exports/');
files.forEach(file => {
  console.log(`${file.key}: ${file.size} bytes`);
});
```

### Get File Metadata

```javascript
const meta = await storage.getMetadata('exports/report.pdf');
if (meta) {
  console.log(`Size: ${meta.size}, Modified: ${meta.lastModified}`);
}
```

### Generate Pre-Signed URL

```javascript
const url = await storage.getSignedUrl('exports/report.pdf', 3600);
// Returns HTTPS URL with 1-hour expiry (R2/S3)
// or file:// URL (local filesystem)
```

### Copy Files

```javascript
await storage.copy('exports/old.pdf', 'exports/archive/old.pdf');
```

### Delete Files

```javascript
await storage.delete('exports/report.pdf');
// No error if file doesn't exist
```

## Migration Script

### Preview Migration (Dry-Run)

```bash
node scripts/migrate_storage.mjs \
  --source=local \
  --target=r2 \
  --prefix=knowledge_base/ \
  --dry-run
```

### Perform Migration

```bash
node scripts/migrate_storage.mjs \
  --source=local \
  --target=r2 \
  --prefix=knowledge_base/
```

### Resume Migration

```bash
# Migrating exports (will skip already-done files)
node scripts/migrate_storage.mjs \
  --source=local \
  --target=r2 \
  --prefix=exports/
```

## Common Patterns

### Atomic JSON File Updates

```javascript
import { getStorageAdapter } from '../storage/index.js';

async function updateJSON(key, updateFn) {
  const storage = getStorageAdapter();

  // Read current
  const current = await storage.get(key);
  const data = current ? JSON.parse(current) : {};

  // Update
  const updated = updateFn(data);

  // Write atomically (via temp file + rename)
  await storage.put(key, JSON.stringify(updated, null, 2));
}

// Usage
await updateJSON('knowledge_base/index.json', (index) => {
  index.updated = new Date().toISOString();
  return index;
});
```

### Streaming Large Files (R2/S3)

```javascript
import { getStorageAdapter } from '../storage/index.js';

// For large files, use multipart upload (S3 SDK supports this)
const storage = getStorageAdapter();
const largeBuffer = fs.readFileSync('large-file.zip');
await storage.put('exports/bundle.zip', largeBuffer, {
  contentType: 'application/zip'
});
```

### Fallback to Avoid Errors

```javascript
async function safeGet(storage, key) {
  try {
    return await storage.get(key);
  } catch (err) {
    console.error(`Failed to get ${key}:`, err.message);
    return null;
  }
}
```

### Batch Operations

```javascript
async function listAndProcess(storage, prefix) {
  const files = await storage.list(prefix);

  for (const file of files) {
    const data = await storage.get(file.key);
    if (data) {
      console.log(`Processing ${file.key} (${file.size} bytes)`);
      // Process data...
    }
  }
}
```

## Error Handling

### Network Errors (R2/S3)

```javascript
try {
  await storage.put('file.txt', data);
} catch (err) {
  if (err.code === 'NoCredentialsError') {
    console.error('Missing AWS credentials');
  } else if (err.code === 'NetworkingError') {
    console.error('Network timeout');
  } else {
    console.error('Storage error:', err.message);
  }
}
```

### File Not Found vs Storage Error

```javascript
const data = await storage.get('file.txt');
if (data === null) {
  // File not found (expected case)
  console.log('File does not exist');
} else if (data instanceof Buffer) {
  // File exists
  console.log('File found, size:', data.length);
}

// Errors are thrown separately
try {
  await storage.get('file.txt');
} catch (err) {
  // Network error, permission denied, etc.
  console.error('Storage error:', err.message);
}
```

## Integration Checklist

- [ ] Install AWS SDK: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
- [ ] Run tests: `npm test -- storageAdapter.test.mjs`
- [ ] Identify file I/O locations in codebase
- [ ] Create R2 bucket and service account
- [ ] Test with `STORAGE_PROVIDER=local` (default)
- [ ] Test with `STORAGE_PROVIDER=r2` and real credentials
- [ ] Deploy dual-write mode for 2-4 week testing period
- [ ] Verify all files migrated correctly
- [ ] Switch to `STORAGE_PROVIDER=r2` for production
- [ ] Monitor for 24+ hours
- [ ] Keep local filesystem as backup (or delete if confident)

## Troubleshooting

**"StorageAdapter.get() is not implemented"**
- You're using the abstract base class directly
- Use `getStorageAdapter()` instead

**"Missing required config"**
- Check all environment variables are set
- For R2: `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

**"AWS SDK not available"**
- Run: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`

**"NoCredentialsError"**
- AWS SDK can't find credentials in environment
- Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (for S3)
- Or set `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (for R2)

**"DualWriteAdapter: put (secondary) failed"**
- This is OK during migration
- Primary write succeeded; secondary is just a fallback
- Check secondary storage (e.g., disk space for local filesystem)

## Performance Tips

- Use CDN for frequently accessed files (CloudFront for S3, R2 sFLY for R2)
- Cache knowledge base index in memory between requests
- Use multipart upload for files > 100 MB
- Implement read-through cache in application layer
- Profile local storage operations vs network operations

## Cost Optimization

**R2 is 30-97x cheaper than S3:**
- Storage: $0.015/GB (R2) vs $0.023/GB (S3)
- Egress: Free (R2) vs $0.09/GB (S3)
- API: First 3M free (R2) vs $0.0004/1K (S3)
- **Recommendation**: Use Cloudflare R2

## Documentation References

- **Full Implementation Guide**: `docs/STORAGE_ADAPTER_IMPLEMENTATION.md`
- **Migration Plan**: `docs/migration/S3_R2_MIGRATION_PLAN.md`
- **Storage Audit**: `docs/migration/STORAGE_RESEARCH_FINDINGS.md`

---

**Quick Start Version:** 1.0
**Date:** March 28, 2026
