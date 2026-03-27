# Appraisal Agent — Known Issues

> Last updated: March 27, 2026

## Form Types

- **1025 and 1073 form types are deferred.** They have no proven end-to-end golden path for generation+export. Files are preserved in the codebase but not actively maintained.
- **1004C** is deferred due to low usage frequency.

## Desktop Integration

- Desktop insertion into ACI/Real Quantum requires a local Windows agent that is not available in the cloud SaaS v1. This is planned for Phase 10 (desktop companion app).

## Restore

- Database restore writes a `data/pending-restore.json` marker file. The actual restore completes on the next server restart. There is no live hot-swap of the database.

## Authentication

- Auth is disabled by default in development (`CACC_AUTH_ENABLED=false`). In production, auth is mandatory.
- JWT_SECRET is auto-generated if not set, which means tokens are invalidated on every server restart. Always set JWT_SECRET in production.

## Routes

- 83 route modules exist in the codebase. Only approximately 20 are actively used by the UI. The rest are stubs or legacy endpoints from earlier development phases.

## Knowledge Base

- The knowledge base currently operates per-user in isolation. Cross-tenant knowledge sharing (the core differentiator) is not yet implemented. This is planned for Phase 7.

## File Storage

- Case files and uploads are stored on the local filesystem. Cloud file storage (S3) migration is planned for Phase 6.

## Billing

- Billing routes return HTTP 503 when Stripe is not configured. This is by design for development environments.
- Monthly quota reset happens via Stripe webhook (`invoice.paid`), not on a calendar schedule.
