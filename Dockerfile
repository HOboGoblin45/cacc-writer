# ---------------------------------------------------------------------------
# Appraisal Agent -- Production Dockerfile
# Multi-stage build: install deps -> copy app -> run as non-root
# ---------------------------------------------------------------------------

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# -- Dependency install stage -----------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# -- App stage --------------------------------------------------------------
FROM base AS app

# Create non-root user for security
RUN groupadd -r appraiser && useradd -r -g appraiser -d /app -s /sbin/nologin appraiser

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create data directories and set ownership
RUN mkdir -p data knowledge_base/users exports logs && \
    chown -R appraiser:appraiser /app

# Required env vars (set at runtime):
#   JWT_SECRET              - 256-bit secret for JWT signing
#   CACC_ENCRYPTION_KEY     - Master encryption key for PII at rest
#   CACC_AUTH_ENABLED=true  - Enforce JWT auth
#
# Optional:
#   OPENAI_API_KEY          - For AI generation fallback
#   RUNPOD_POD_ID           - For proprietary model inference
#   STRIPE_SECRET_KEY       - For billing integration
#   DATABASE_PATH           - Override default SQLite path (default: data/cacc.db)

# Expose port
EXPOSE 5178

# Switch to non-root
USER appraiser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:5178/api/health').then(r=>r.json()).then(d=>process.exit(d.ok?0:1)).catch(()=>process.exit(1))"

# Start
CMD ["node", "cacc-writer-server.js"]
