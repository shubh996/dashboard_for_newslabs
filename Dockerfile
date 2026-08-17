# Railway / any container host — API only (no Vite frontend build)
# Node 22.14+ satisfies vite/oxlint engine ranges if any transitive tooling is present.
FROM node:22.14-bookworm-slim

WORKDIR /app

# Keep npm cache outside node_modules (avoids EBUSY rmdir on /.cache in some builders)
ENV NPM_CONFIG_CACHE=/tmp/npm-cache \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

RUN mkdir -p /tmp/npm-cache /app/data /app/logs \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# Prefer ci for lockfile fidelity; fall back to install if lock is flaky in CI cache
RUN npm ci --omit=dev --no-audit --no-fund \
  || npm install --omit=dev --no-audit --no-fund

# Runtime sources (momentum engine, notifications, yahoo, …)
COPY server ./server
COPY public ./public

# Optional empty dirs for local JSON mirrors / PM2-style logs
RUN mkdir -p data logs

EXPOSE 3001

# Railway injects PORT; server/index.js reads PORT || API_PORT
CMD ["node", "server/index.js"]
