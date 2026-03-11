FROM node:22-slim AS base

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, canvas)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Build TypeScript
RUN npm run build || true

# Create data directory
RUN mkdir -p data cases logs

# Expose server port
EXPOSE 5178

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:5178/api/workflow/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "cacc-writer-server.js"]
