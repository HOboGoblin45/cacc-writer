# Appraisal Agent — v1 SaaS Release Checklist

> Go/no-go gates for v1 cloud pilot launch.

- [ ] All active form lanes pass golden-path test (import → generate → export) for 1004 and commercial
- [ ] Auth middleware rejects unauthenticated requests in production
- [ ] Per-user DB isolation verified (user A cannot see user B's cases)
- [ ] Stripe checkout creates subscription successfully
- [ ] Stripe webhook updates subscription status
- [ ] Quota enforcement blocks generation when limit reached
- [ ] Restore completes successfully with SHA-256 hash verification
- [ ] CORS allows only configured origins
- [ ] JWT_SECRET is required and stable in production
- [ ] No route returns fake-green success for failed operations
- [ ] README, roadmap, and scope config all agree on active form types (1004, commercial)
- [ ] `npm test` passes with 0 failures
- [ ] Signup page renders and creates user successfully
- [ ] Login page renders and authenticates successfully
- [ ] Export (PDF/DOCX download) works from Step 5
- [ ] Health check endpoint returns accurate status
- [ ] Error responses use correct HTTP status codes (not 200 with error body)
