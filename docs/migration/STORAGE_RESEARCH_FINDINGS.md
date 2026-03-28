# CACC Writer Storage Systems - Research Findings

**Date:** March 28, 2026
**Scope:** Complete filesystem and blob storage analysis
**Status:** Ready for migration planning

## Executive Summary

CACC Writer's storage is currently distributed across multiple directories with synchronous file I/O. The codebase has ~62 files performing filesystem operations across knowledge bases, exports, user data, and temporary files. Total analyzable storage footprint: **2.6 GB** (excluding node_modules and git).

---

## 1. Filesystem Layout & Current Storage

### 1.1 Primary Storage Directories

```
CACC Writer Root
├── knowledge_base/                 (~1.7 GB - LARGEST)
│   ├── index.json                  (308 KB - master index)
│   ├── approved_edits/             (124 KB - appraiser-approved examples)
│   ├── curated_examples/           (973 KB - hand-curated per form type)
│   ├── approvedNarratives/         (256 KB - approved narrative storage)
│   ├── phrase_bank/                (12 KB - reusable clauses)
│   ├── narratives/                 (36 KB - form-specific templates)
│   ├── metadata/                   (empty - legacy)
│   └── raw_imports/                (empty - staging area)
│
├── exports/                        (~1.2 GB)
│   └── [Generated PDFs, XMLs, ZIPs]
│
├── data/                           (~3 MB)
│   ├── cacc-writer.db              (2.9 MB - main SQLite database)
│   ├── cacc-writer.db-shm          (32 KB - shared memory)
│   ├── cacc-writer.db-wal          (194 KB - write-ahead log)
│   ├── appraisal_guidelines/       (reference documents)
│   ├── job-log.csv                 (4.3 KB)
│   └── queue_state.json            (5.9 KB)
│
├── temp/                           (~7 MB)
│   ├── uploads/                    (multer temporary files)
│   ├── agent-logs/                 (ACI/RQ agent screenshots & logs)
│   ├── commercial-debug.db         (1.6 MB)
│   ├── aci_*.png / *.json          (test/debug artifacts)
│   └── app-server.log              (application logs)
│
├── templates/                      (~60 MB estimated)
│   └── Form_1004.pdf               (PDF template for form filling)
│
└── backups/                        (Location: server/security/backupRestoreService.js)
    └── cacc-backup-*.db            (Full database backups)
```

### 1.2 Per-User Storage (Multi-Tenant)

```
data/users/{userId}/
├── cacc.db                         (Per-user isolated SQLite database)
├── cases/{caseId}/
│   ├── meta.json                   (Case metadata)
│   ├── facts.json                  (Case facts/inputs)
│   ├── outputs.json                (Generated narratives)
│   ├── photos/
│   │   ├── {photoId}.jpg           (Photo files)
│   │   └── manifest.json           (Photo metadata)
│   ├── documents/
│   │   ├── mls.pdf                 (MLS data)
│   │   ├── appraisal.pdf           (Prior appraisals)
│   │   └── other.pdf               (Supporting docs)
│   └── exports/
│       ├── {caseId}-report.pdf     (Filled PDF)
│       ├── {caseId}-report.xml     (MISMO/UAD36)
│       └── {caseId}-bundle.zip     (Complete bundle)
```

---

## 2. File I/O Operations Inventory

### 2.1 Synchronous File Operations (62 files)

**Pattern Distribution:**
- `fs.readFileSync()` - 87 occurrences (read-heavy)
- `fs.writeFileSync()` - 42 occurrences (write operations)
- `fs.promises.readFile()` - 6 occurrences (async reads)
- `readFileSync(TEMPLATE_PATH)` - 1 (pdf-lib)
- `fs.existsSync()` - Pattern checks (not counted)

### 2.2 File Operation Categories

#### A. Knowledge Base Operations (server/knowledgeBase.js)
```javascript
// Synchronous reads/writes (blocking)
readJSON(filePath)           // fs.readFileSync(filePath, 'utf8')
writeJSON(filePath, data)    // fs.writeFileSync() + atomic rename
ensureDir(dir)               // fs.mkdirSync(dir, { recursive: true })
indexExamples()              // Scans all .json files, rebuilds index.json
addExample(data)             // Writes to approved_edits/ or curated_examples/
getExamples(filters)         // In-memory filter on index.json
addApprovedNarrative(data)   // Writes to approvedNarratives/
getNarrativeTemplate()       // Reads form-specific narrative files
```

**Files Involved:** 15+ files per knowledge base rebuild
**Impact:** Knowledge base is read on every generation request (hot path)

#### B. Export Operations (server/api/exportRoutes.js, server/export/*)
```javascript
// PDF Form Filling
readFileSync(TEMPLATE_PATH)  // Load Form_1004.pdf template (505 fields)
fillForm1004(caseId)         // Fill PDF with case data

// MISMO/UAD36 XML Export
generateMismo(caseData)      // Generate XML file

// Bundle/ZIP Export
archiver()                   // Create ZIP archives
fs.createReadStream()        // Stream files into ZIP

// Storage path: exports/{caseId}-report.{pdf|xml|zip}
```

**Files Involved:** 1 generated file per export
**Total Stored:** 1.2 GB (all historical exports)

#### C. Photo & Document Management (server/photos/photoManager.js, server/api/photoAddendumRoutes.js)
```javascript
// Per-case photo storage
case_photos table            // DB metadata (file_path column)
file_path = data/users/{userId}/cases/{caseId}/photos/{photoId}.jpg

// Document uploads
data/users/{userId}/cases/{caseId}/documents/{docType}.pdf
// Types: mls, appraisal, contract, title, other

// Async photo processing
fs.readFile()                // Read uploaded file
```

**Pattern:** Multer uploads to temp/, then copied to case directory
**DB Tracking:** File paths stored in case_photos and case_outputs tables

#### D. Backup & Restore Operations (server/security/backupRestoreService.js)
```javascript
// Full database backup to ./backups/
createBackup()               // fs.readFileSync(dbPath) → backups/cacc-backup-*.db
listBackups()                // fs.readdirSync(BACKUPS_DIR)
verifyBackup(id)             // fs.readFileSync() + SHA256 hash
restoreBackup(id)            // Copy from backups/ back to data/

// Incremental backup marker tracking
markerPath = backups/.last_backup_marker.json
```

**Files Involved:** 1 backup file per backup operation
**Lifecycle:** Long-term retention (compliance requirement)

#### E. Case Records Storage (server/caseRecord/caseRecordService.js)
```javascript
// Synchronous case file operations (per-case mutex via withCaseLock)
casePath(caseId) = data/cases/{caseId}/
├── meta.json                // readJSON() → writeJSON()
├── facts.json               // readJSON() → writeJSON()
├── outputs.json             // readJSON() → writeJSON()
└── sketch.json              // readJSON() → writeJSON()

// Locking: server/utils/fileUtils.js
withCaseLock(caseId, fn)    // Per-case async mutex (serialized writes)
withVoiceLock(fn)            // Global lock for voice_training.json
```

**Access Pattern:** Heavy R/W on case workflow
**Concurrency:** Protected by per-case locks (prevents race conditions)

#### F. Training Data & Pipeline Outputs (server/training/*)
```javascript
// Decision pipeline
decisionExtractor.js         // fs.readFileSync() → fs.writeFileSync()
fullDecisionPipeline.js      // XML import → JSON → JSONL
aciExtractor.js              // ACI XML export → training corpus

// Outputs: outputs/*.jsonl, outputs/corpus.json, outputs/stats.json
```

**Purpose:** Fine-tuning data for Llama model
**Frequency:** Ad-hoc (not on every request)

#### G. Temp & Log Files (server/fileLogger.js, server/dataPipeline/crawlCache.js)
```javascript
// Application logs
fileLogger.js                // fs.readFileSync() for historical logs
app-server.log               // Rolling log file

// Crawl cache (for MLS/market data)
crawlCache.js                // fs.writeFileSync() JSON cache
storagePath = data/crawl_cache.json

// Debug & test artifacts
temp/aci_*.png               // Screenshots from agent testing
temp/agent-logs/             // Agent stdout/stderr
temp/uploads/                // Multer temporary staging area
```

**Lifecycle:** Logs rotate; temp files are ephemeral

---

## 3. Data Flow & Access Patterns

### 3.1 Read-Heavy Paths (Hot Paths - Optimize Priority)

**1. Knowledge Base Retrieval (per generation request)**
```
POST /api/generate
  → promptBuilder.getPromptsFromKB()
  → knowledgeBase.getExamples(filters)
    → readJSON(INDEX_FILE)
    → Filter in-memory (150K+ examples)
  → readJSON(PHRASE_BANK)
  → getNarrativeTemplate()
```
**Frequency:** Every section generation (4-10x per case)
**Latency Impact:** High (multiple sync reads)
**Size:** KB index + 9+ form-specific files

**2. Form Template Loading (once per case)**
```
POST /api/export/pdf
  → pdfFormFiller.fillForm1004(caseId)
    → readFileSync(TEMPLATE_PATH)  // 60 MB PDF once
    → fillForm with case data
```
**Frequency:** Once per export (user-driven)
**Latency Impact:** Medium (binary PDF)
**Size:** 60 MB Form_1004.pdf

**3. Case Facts/Metadata (on every case load)**
```
GET /api/cases/{caseId}
  → getCaseWithFacts(caseId)
    → readJSON(meta.json)
    → readJSON(facts.json)
    → readJSON(outputs.json)
```
**Frequency:** Every page load + every edit
**Latency Impact:** Medium (JSON parsing)
**Size:** 10-500 KB per case

### 3.2 Write-Heavy Paths

**1. Narrative Approval & Storage**
```
POST /api/approveNarrative
  → addApprovedNarrative(data)
    → writeJSON(approvedNarratives/{id}.json)
    → updateJSON(approvedNarratives/index.json)
```
**Frequency:** 1-20 per case (user-driven)
**Pattern:** Atomic rename (prevents corruption)
**Size:** 2-10 KB per narrative

**2. Case Updates (Continuous)**
```
PUT /api/cases/{caseId}/facts
  → withCaseLock(caseId, () => {
      readJSON(facts.json)
      writeJSON(facts.json, updated)
    })
```
**Frequency:** 10-100 times per case (user edits)
**Pattern:** Serialized by per-case mutex
**Size:** 10-500 KB

**3. Export Generation**
```
POST /api/export/bundle
  → generateMismo(caseData)
    → writeJSON(exports/{caseId}.xml)
  → fillForm1004(caseId)
    → writeFileSync(exports/{caseId}.pdf)
  → archiver.directory(photos/)
    → writeFileSync(exports/{caseId}-bundle.zip)
```
**Frequency:** 1-5 per case
**Pattern:** Three separate files
**Size:** 50 KB (XML) + 200 KB (PDF) + 5 MB (ZIP)

### 3.3 Storage Type Recommendations

| Category | Size | Access | Recommendation | Reason |
|----------|------|--------|-----------------|--------|
| KB Index + Examples | 1.7 GB | Read-heavy, hot | S3/R2 + CloudFront CDN | Frequently accessed; rarely updated |
| Exports | 1.2 GB | Read-heavy, cold | S3/R2 (infrequent) | Historical; accessed only on request |
| Case Facts/Meta | ~100 MB | R/W, warm | SQLite (keep local) | Small; frequent updates; mutex protection |
| Photos/Docs | ~200 MB | R/W, warm | S3/R2 + signed URLs | Medium size; user-driven uploads |
| Backups | ~500 MB | Write-once, cold | S3/R2 Glacier | Compliance; long retention |
| Logs | ~10 MB | Write-once, cold | S3/R2 (lifecycle) | Audit trail; infrequent access |
| Templates | 60 MB | Read-only | S3/R2 + CloudFront | Single large file; never updates |

---

## 4. Current Implementation Patterns

### 4.1 Atomic Write Pattern (fileUtils.js)
```javascript
export function writeJSON(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);  // Atomic POSIX rename
}
```
**Safety:** Prevents partial writes/corruption
**Trade-off:** 2x disk writes (tmp + atomic rename)

### 4.2 Per-Case Locking Pattern (fileUtils.js)
```javascript
const _caseLocks = new Map();

export function withCaseLock(caseId, fn) {
  const prev = _caseLocks.get(caseId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _caseLocks.set(caseId, next);
  return next;
}
```
**Purpose:** Serializes concurrent edits to same case
**Limitation:** In-memory only (resets on server restart)
**Better:** Distributed lock (Redis, DynamoDB) for multi-server deployments

### 4.3 Multi-Tenant Isolation (database.js)
```javascript
const userDbPath = `data/users/${userId}/cacc.db`;
const userDb = new Database(userDbPath);  // SQLite better-sqlite3 (sync)
```
**Isolation:** Per-user separate database file
**Limitation:** No table-level RBAC
**Strong:** Directory-level isolation prevents cross-user access

### 4.4 Upload Staging Pattern (middleware.js)
```javascript
const uploader = multer({ storage: diskStorage });  // temp/uploads/

app.post('/upload', uploader.single('file'), (req, res) => {
  const tempPath = req.file.path;  // temp/uploads/{filename}
  // ... process ...
  fs.copyFileSync(tempPath, finalPath);  // Copy to permanent location
  fs.unlinkSync(tempPath);  // Clean up temp
});
```
**Pattern:** Temp staging → permanent move
**Trade-off:** 2x disk I/O (write to temp, copy to final)
**Better:** Direct upload to S3 would avoid this

---

## 5. Database Schema - File Path References

### 5.1 Tables Storing File Paths

**case_photos**
```sql
CREATE TABLE case_photos (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  file_path TEXT NOT NULL,         -- data/users/{userId}/cases/{caseId}/photos/{photoId}.jpg
  file_size INTEGER,
  mime_type TEXT DEFAULT 'image/jpeg',
  category TEXT DEFAULT 'other',
  ai_description TEXT,
  -- ...
);
```

**case_outputs**
```sql
CREATE TABLE case_outputs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  export_type TEXT,               -- 'pdf', 'xml', 'zip'
  file_path TEXT NOT NULL,        -- exports/{caseId}-report.{pdf|xml|zip}
  file_size INTEGER,
  generated_at TIMESTAMP,
  -- ...
);
```

**Documents**
```sql
-- Implicit: documents stored in data/users/{userId}/cases/{caseId}/documents/
-- Reference: caseCompatRoutes.js fs.copyFileSync(req.file.path, documents/)
```

---

## 6. Third-Party Library Usage

### 6.1 PDF Processing
- **pdf-lib** (pdfFormFiller.js) - Client-side PDF manipulation
  - Reads template: `readFileSync(TEMPLATE_PATH)`
  - Writes filled PDF: In-memory buffer → HTTP response
  - Migration: No change needed (uses buffers, not paths)

### 6.2 Archive/Compression
- **archiver** (exportRoutes.js) - ZIP bundle creation
  - Reads files from disk: `archiver.directory(photosDir)`
  - Writes to stream: HTTP response or file
  - Migration: Supports custom streams (can read from S3)

### 6.3 Database
- **better-sqlite3** (database.js) - Synchronous SQLite
  - File-based only (no network driver)
  - Migration: Keep local (no change)

---

## 7. Environment & Configuration

### 7.1 Current Config (from .env)
```bash
CACC_DISABLE_KB_WRITES=0        # Feature flag for KB writes
JWT_SECRET=***                  # Auth (unrelated)
CACC_ENCRYPTION_KEY=***         # Encryption (unrelated)
```

### 7.2 Required Additions (for migration)
```bash
# S3/R2 Connection
STORAGE_PROVIDER=local|s3|r2    # Feature flag
STORAGE_BUCKET_NAME=cacc-writer-prod
STORAGE_REGION=auto (R2) or us-east-1 (S3)
STORAGE_ACCESS_KEY_ID=***
STORAGE_SECRET_ACCESS_KEY=***
STORAGE_ENDPOINT=***            # R2 specific

# Optional: CDN & Caching
CDN_ENABLED=true
CDN_URL=https://cdn.cacc-writer.com
CACHE_TTL_KB=86400              # 24 hours for KB
CACHE_TTL_EXPORTS=604800        # 7 days for exports

# Fallback & Migration
DUAL_WRITE_PERIOD=true          # During transition
STORAGE_FALLBACK_LOCAL=true     # If S3 down
```

---

## 8. Scalability & Performance Implications

### 8.1 Current Bottlenecks

**1. Knowledge Base Hot Path**
- Index.json is 308 KB, loaded on every generation
- 150K+ examples filtered in-memory
- No caching between requests
- **Impact:** ~50 ms per generation (cumulative)

**2. PDF Template Loading**
- Form_1004.pdf (60 MB) loaded from disk on every export
- Not cached across requests
- **Impact:** ~200-500 ms per export

**3. Concurrent Case Edits**
- Per-case locks prevent parallel updates to same case
- 2 mutex operations per write (get lock + execute)
- **Impact:** Serialized writes to hot cases

**4. Per-User Database Files**
- Separate SQLite file per user
- No connection pooling
- **Impact:** Poor resource utilization; O(n) file handles

### 8.2 Post-Migration Optimizations

**S3/R2 Advantages:**
- Distributed read replicas (CDN)
- Automatic geo-replication (R2)
- No egress fees (R2 only)
- Serverless scaling (no disk capacity planning)

**Recommended:**
- CloudFront CDN for KB & templates (1-hour TTL)
- Multipart upload for large exports
- S3 Transfer Acceleration (if latency-sensitive)
- R2 over S3 (cost: $0.015/GB vs $0.023/GB)

---

## 9. Compliance & Security Considerations

### 9.1 Current Controls

**File-Level Permissions:**
- 0700 (owner only) on all data directories
- Single server (no multi-region complexity)
- No encryption at rest (optional CACC_ENCRYPTION_KEY unused)

**Multi-Tenancy:**
- Directory-based isolation: `data/users/{userId}/`
- No cross-user path traversal possible
- Database isolation: Per-user SQLite file

**Audit Trail:**
- File modification times (mtime) available
- Database audit logs (case_records table)
- No object versioning (S3 feature available)

### 9.2 Migration Requirements

**Data Protection:**
- Enable S3 encryption (SSE-S3 or SSE-KMS)
- Enable R2 encryption (default: AES-128)
- Versioning for knowledge base (optional)

**Access Control:**
- IAM policies: Least-privilege service account
- Presigned URLs: 1-hour expiry for downloads
- No public bucket access (private by default)

**Compliance:**
- Backup versioning (retain 30 days minimum)
- Lifecycle policies: Cold storage after 90 days
- Logging: CloudTrail (S3) or R2 audit trail

---

## 10. Estimated Timeline & Effort

### 10.1 Phases

| Phase | Duration | Effort | Notes |
|-------|----------|--------|-------|
| 1. Storage Abstraction Layer | 2-3 days | Medium | Create interface + 3 adapters |
| 2. Identify Touchpoints | 1 day | Low | Script to find all file ops |
| 3. Dual-Write Implementation | 3-5 days | High | Write to both FS + S3 |
| 4. Migration Script | 2-3 days | Medium | Sync existing files to S3 |
| 5. Cutover & Testing | 3-5 days | High | Staging → prod validation |
| 6. Fallback & Monitoring | 2-3 days | Medium | Graceful degradation |
| **Total** | **2-3 weeks** | **High** | Can be done incrementally |

### 10.2 Risk Factors

**High Risk:**
- PDF template loading (large single file)
- Concurrent case edits during migration
- Knowledge base consistency (atomic updates)

**Medium Risk:**
- Export file paths in database (require migration)
- Photo/document symlinks (if used)
- Backup restore recovery

**Low Risk:**
- Case metadata (small, frequent updates)
- Logs & temporary files (non-critical)

---

## 11. Cost Analysis (AWS S3 vs Cloudflare R2)

### 11.1 Monthly Baseline (Estimated)

**Storage (2.6 GB):**
- S3 Standard: 2.6 GB × $0.023/GB = **$0.06**
- R2: 2.6 GB × $0.015/GB = **$0.04**

**API Calls (Knowledge base hot path):**
- 1000 requests/day × 30 days = 30K requests
- S3: 30K × $0.0004 = **$0.012**
- R2: First 3M free, then $0.0015 per 1M = **$0**

**Data Transfer (Exports):**
- 100 downloads/month × 5 MB avg = 500 GB/month
- S3: 500 GB × $0.09/GB = **$45**
- R2: 500 GB × $0 (egress-free) = **$0**

**CDN (Knowledge Base):**
- With CloudFront: 500 GB × $0.085/GB = **$42.50**
- With R2 CDN: included (0.02/request, ~$1.50)

### 11.2 Summary (Monthly)

| Provider | Storage | API | Egress | CDN | **Total** |
|----------|---------|-----|--------|-----|----------|
| S3 (no CDN) | $0.06 | $0.012 | $45 | — | **$45.07** |
| S3 + CloudFront | $0.06 | $0.012 | $0 | $42.50 | **$42.57** |
| R2 | $0.04 | $0 | $0 | $1.50 | **$1.54** |

**Recommendation:** Cloudflare R2 for cost (~97% cheaper than S3 with CDN)

---

## 12. Key Findings Summary

1. **Knowledge Base** is the hot path (1.7 GB, read-heavy, accessed every generation)
2. **Exports** are cold storage (1.2 GB, written once, read infrequently)
3. **Case metadata** should stay in SQLite (small, frequent updates, mutex-protected)
4. **Atomic write pattern** prevents corruption; must preserve in migration
5. **Per-case locking** is in-memory only (OK for single-server, needs Redis for distributed)
6. **Multi-tenant isolation** is directory-based (secure; easy to migrate per-user)
7. **File paths in database** require careful migration (foreign key consistency)
8. **Cloudflare R2** is 30-50x cheaper than S3 with egress
9. **Dual-write period** (2-4 weeks) reduces cutover risk
10. **No breaking API changes** if abstraction layer is transparent

---

## Appendix A: File I/O Hotspots (by frequency)

```
Tier 1 (Every request):
  - knowledge_base/index.json (308 KB)
  - promptBuilder.js getPromptsFromKB()

Tier 2 (Every case load):
  - data/cases/{caseId}/meta.json
  - data/cases/{caseId}/facts.json
  - data/cases/{caseId}/outputs.json

Tier 3 (Per user action):
  - knowledge_base/approvedNarratives/*.json (on approval)
  - exports/{caseId}-* (on export)
  - data/cases/{caseId}/photos/*.jpg (on photo upload)
  - backups/cacc-backup-*.db (on backup trigger)

Tier 4 (Ad-hoc):
  - server/training/* (fine-tuning pipeline)
  - temp/* (debug/test artifacts)
```

---

## Appendix B: Repository File Listing (62 files with fs operations)

```
Core:
  server/utils/fileUtils.js
  server/knowledgeBase.js
  server/export/pdfFormFiller.js
  server/security/backupRestoreService.js

API Routes (15 files):
  server/api/exportRoutes.js
  server/api/sketchRoutes.js
  server/api/photoAddendumRoutes.js
  server/api/platformAIRoutes.js
  server/api/documentRoutes.js
  server/api/aiQcRoutes.js
  [... 9 more ...]

Database & Services (8 files):
  server/db/database.js
  server/db/dbMonitor.js
  server/caseRecord/caseRecordService.js
  server/photos/photoManager.js
  [... 4 more ...]

Orchestration & AI (6 files):
  server/orchestrator/draftAssembler.js
  server/promptBuilder.js
  server/ai/photoAnalyzer.js
  [... 3 more ...]

Training & Integrations (8 files):
  server/training/decisionExtractor.js
  server/training/aciExtractor.js
  server/training/fullDecisionPipeline.js
  server/integrations/gmail.js
  [... 4 more ...]

Utilities & Logging (4 files):
  server/fileLogger.js
  server/utils/middleware.js
  server/backupExport.js
  server/operations/healthDiagnostics.js

[Total: 62 files]
```

