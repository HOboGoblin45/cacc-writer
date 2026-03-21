# Appraisal Agent â€” Machine Migration Runbook

Last updated: 2026-03-13
Authority: DoD #10 â€” "Backup, restore, and machine migration are supported and tested."

---

## Overview

This runbook covers moving Appraisal Agent from one machine to another while preserving all case data, knowledge base, learned patterns, voice profiles, and backup history. The process takes approximately 15 minutes for a typical installation.

---

## Prerequisites

**Source machine:**
- Appraisal Agent is installed and accessible.
- No active insertion operations running.

**Target machine:**
- Node.js 18+ installed.
- Git (if cloning fresh) or file transfer method available (USB, network share, rsync).
- Same or newer OS (Windows/macOS/Linux).

---

## Data Topology

All persistent data lives within the project directory:

```
cacc-writer/
â”œâ”€â”€ data/
â”‚   â””â”€â”€ cacc-writer.db          â† SQLite database (ALL structured data)
â”œâ”€â”€ cases/
â”‚   â””â”€â”€ [case-id]/              â† Case files (meta, facts, outputs, history, documents)
â”œâ”€â”€ knowledge_base/
â”‚   â”œâ”€â”€ index.json              â† Master KB index
â”‚   â”œâ”€â”€ approvedNarratives/     â† Voice-trained narratives
â”‚   â”œâ”€â”€ approved_edits/         â† Appraiser-approved edits
â”‚   â”œâ”€â”€ curated_examples/       â† Hand-curated examples by form type
â”‚   â”œâ”€â”€ narratives/             â† Narrative templates
â”‚   â””â”€â”€ phrase_bank/            â† Reusable clauses
â”œâ”€â”€ backups/
â”‚   â””â”€â”€ cacc-backup-*.db        â† Database backups
â”œâ”€â”€ logs/
â”‚   â””â”€â”€ cacc-*.log              â† Daily JSON-lines logs
â””â”€â”€ exports/
    â””â”€â”€ cacc-writer-support-bundle-*/  â† Support bundles
```

**Environment variables** (optional overrides):
| Variable | Default | Purpose |
|----------|---------|---------|
| `CACC_DB_PATH` | `./data/cacc-writer.db` | Database file location |
| `CACC_LOGS_DIR` | `./logs` | Log file directory |
| `OPENAI_API_KEY` | â€” | Required for AI generation |
| `PORT` | `5178` | Server port |

---

## Step 1: Create a Pre-Migration Backup (Source Machine)

Stop all active work, then create a verified backup.

**Option A â€” Via API:**
```bash
# Create backup
curl -X POST http://localhost:5178/api/security/backups/create \
  -H "Content-Type: application/json" -d '{}'

# Note the returned backupId, then verify
curl -X POST http://localhost:5178/api/security/backups/BACKUP_ID/verify
```

**Option B â€” Via UI:**
1. Go to the **System** tab.
2. Click **Create Backup**.
3. Wait for confirmation.

**Option C â€” Manual SQLite copy (if server is stopped):**
```bash
cd /path/to/cacc-writer
sqlite3 data/cacc-writer.db ".backup 'backups/pre-migration.db'"
```

---

## Step 2: Copy Data to Target Machine

Copy the entire project directory, or at minimum these directories:

### Required (data loss without these)
| Directory/File | Contains |
|---------------|----------|
| `data/cacc-writer.db` | All structured data: cases, facts, sections, patterns, users, backups metadata |
| `cases/` | Case file artifacts (documents, meta, facts, outputs, history) |
| `knowledge_base/` | Training data, approved narratives, curated examples, phrase bank |

### Recommended (preserve history)
| Directory/File | Contains |
|---------------|----------|
| `backups/` | Database backup files |
| `logs/` | Historical application logs |
| `exports/` | Support bundle archives |

### Transfer commands

**rsync (preferred â€” incremental, handles interruptions):**
```bash
rsync -avz --progress \
  /source/cacc-writer/data \
  /source/cacc-writer/cases \
  /source/cacc-writer/knowledge_base \
  /source/cacc-writer/backups \
  /source/cacc-writer/logs \
  user@target:/path/to/cacc-writer/
```

**Manual copy:**
```bash
# On source, create a single archive
cd /path/to/cacc-writer
tar czf cacc-migration.tar.gz data/ cases/ knowledge_base/ backups/ logs/ exports/

# Transfer to target (USB, SCP, etc.)
scp cacc-migration.tar.gz user@target:/path/to/cacc-writer/

# On target, extract
cd /path/to/cacc-writer
tar xzf cacc-migration.tar.gz
```

---

## Step 3: Install Dependencies on Target

```bash
cd /path/to/cacc-writer
npm install
```

If using Electron desktop:
```bash
npm run package    # or npm run make
```

---

## Step 4: Set Environment Variables on Target

Copy your `.env` file or set variables:

```bash
# Required for AI generation
export OPENAI_API_KEY=sk-...

# Optional overrides (usually not needed if directory structure is preserved)
# export CACC_DB_PATH=/custom/path/cacc-writer.db
# export CACC_LOGS_DIR=/custom/path/logs
# export PORT=5178
```

---

## Step 5: Start and Verify on Target

### Start the server
```bash
npm start
# or for Electron desktop:
npm run desktop
```

### Verify health
```bash
# Server health
curl http://localhost:5178/api/health

# Database status
curl http://localhost:5178/api/db/status

# DR readiness
curl http://localhost:5178/api/security/dr-status

# Operations dashboard
curl http://localhost:5178/api/operations/dashboard
```

### Verify data integrity

**Check case count:**
```bash
curl http://localhost:5178/api/cases
```
Compare the number of cases with the source machine.

**Check knowledge base:**
```bash
curl http://localhost:5178/api/kb/status
```
Verify narrative counts and example counts match source.

**Check learned patterns:**
```bash
curl http://localhost:5178/api/learning/patterns
```
Verify patterns are present and confidence scores are preserved.

**Check backup history:**
```bash
curl http://localhost:5178/api/security/backups
```
Verify prior backups are listed.

---

## Step 6: Post-Migration Backup on Target

Create a first backup on the target to establish the backup chain:

```bash
curl -X POST http://localhost:5178/api/security/backups/create \
  -H "Content-Type: application/json" -d '{}'
```

---

## Verification Checklist

After migration, confirm each item:

- [ ] Server starts without errors
- [ ] `/api/health` returns `ok`
- [ ] Case list shows all expected cases
- [ ] Opening a case shows facts, outputs, and history
- [ ] Knowledge base status shows expected counts
- [ ] Learned patterns are present with correct confidence
- [ ] Voice profiles are intact
- [ ] Backup schedule is configured
- [ ] A new backup completes successfully
- [ ] (If applicable) Electron desktop launches and displays UI

---

## Troubleshooting

### "Database is locked"
The SQLite database uses WAL mode. If you see lock errors:
1. Ensure no other Appraisal Agent process is running on the same data directory.
2. Delete stale WAL/SHM files if they exist: `data/cacc-writer.db-wal`, `data/cacc-writer.db-shm`.
3. Restart the server.

### "Missing tables" or schema errors
The database auto-initializes missing tables on startup. If tables are missing:
1. Check that `data/cacc-writer.db` is a valid SQLite file: `sqlite3 data/cacc-writer.db ".tables"`
2. If corrupt, restore from the most recent backup: `cp backups/cacc-backup-LATEST.db data/cacc-writer.db`

### Cases directory empty but database has records
Case files on disk and database records are complementary. If case files are missing:
1. The system will still show cases from the database.
2. Document uploads and file-based artifacts (PDFs, photos) will be missing.
3. Re-upload documents as needed.

### Knowledge base shows zero examples
1. Check that `knowledge_base/` directory was copied.
2. Check `knowledge_base/index.json` exists and is valid JSON.
3. If using migrated voice data, run: `POST /api/kb/migrate-voice`

### Wrong port or connection refused
1. Check `PORT` environment variable.
2. Default is `5178`.
3. Ensure no other service is using the same port.

---

## Rollback Plan

If migration fails, the source machine data is unchanged:

1. Stop Appraisal Agent on target.
2. Continue using source machine as before.
3. Investigate the issue using logs at `logs/cacc-*.log`.
4. Retry migration after resolving the issue.

If you need to revert the target to a known state:
```bash
# Restore from pre-migration backup
cp backups/pre-migration.db data/cacc-writer.db
# Restart server
npm start
```

---

## Notes

- **Data sovereignty:** All data remains local. No cloud sync or external dependencies.
- **SQLite portability:** The database file is cross-platform (Windows â†” macOS â†” Linux).
- **Backup retention:** Default schedule keeps 10 backups with 30-day retention. Adjust via `PUT /api/security/backups/schedule`.
- **Large installations:** For cases with many uploaded documents (100+ cases), the `cases/` directory may be several GB. Plan transfer time accordingly.

