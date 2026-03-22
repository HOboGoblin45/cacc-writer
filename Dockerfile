# ─────────────────────────────────────────────────────────────────────────────
# Appraisal Agent — Production Dockerfile
# Multi-stage build: install deps → copy app → run
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# ── Dependency install stage ─────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── App stage ────────────────────────────────────────────────────────────────
FROM base AS app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create data directory for SQLite
RUN mkdir -p data knowledge_base/users exports

# Expose port
EXPOSE 5178

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:5178/api/health').then(r=>r.json()).then(d=>process.exit(d.ok?0:1)).catch(()=>process.exit(1))"

# Start
CMD ["node", "cacc-writer-server.js"]
