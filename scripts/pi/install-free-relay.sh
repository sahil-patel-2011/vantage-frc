#!/usr/bin/env bash
# Pi / always-on host setup for Vantage free-relay (Freebuff proxy + memory dreaming).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

echo "== Vantage free-relay Pi installer =="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required."
  exit 1
fi

npm install

cat <<'ENV'
Add these to your Pi environment (systemd, .env, or shell profile):

  DATABASE_ADMIN_URL=postgres://...   # vantage_worker role
  FREE_RELAY_BASE_URL=http://127.0.0.1:8080/v1   # Freebuff2API or local OpenAI proxy
  FREE_RELAY_API_KEY=your-proxy-key-or-freebuff
  FREE_RELAY_MODEL=deepseek-v4-flash
  FREE_RELAY_PROVIDER=freebuff
  FREE_RELAY_INTERVAL_MS=300000

Optional fallback when no local proxy:
  OPENROUTER_API_KEY=sk-or-...

Run once:
  npm run free-relay:sweep

Daemon (every 5 min by default):
  npm run free-relay:daemon

ENV

echo "Done. Start your Freebuff proxy first (e.g. Freebuff2API on :8080)."
