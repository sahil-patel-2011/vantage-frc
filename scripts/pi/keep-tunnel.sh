#!/usr/bin/env bash
# Keep the Pi layer + inbound Cloudflare tunnel running. Safe to run from cron
# or a user systemd timer. Never prints keys.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${FREE_RELAY_ENV_FILE:-$REPO_ROOT/.env.free-relay}"
LAYER_PORT="${FREE_RELAY_PROXY_PORT:-8080}"
LOG_DIR="${FREE_RELAY_LOG_DIR:-$HOME/.local/state/vantage-freebuff}"
mkdir -p "$LOG_DIR"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  # Only load non-comment assignments; do not echo them.
  . "$ENV_FILE"
  set +a
fi

layer_up() {
  curl -fsS -m 4 "http://127.0.0.1:${LAYER_PORT}/healthz" >/dev/null 2>&1
}

if ! layer_up; then
  cd "$REPO_ROOT"
  nohup npm run free-relay:serve >>"$LOG_DIR/pi-layer.log" 2>&1 &
  sleep 2
fi

if ! pgrep -f "free-relay:daemon|cli-sweep" >/dev/null 2>&1; then
  cd "$REPO_ROOT"
  nohup npm run free-relay:daemon >>"$LOG_DIR/pi-sweep.log" 2>&1 &
fi

if ! pgrep -f "cloudflared.*${LAYER_PORT}" >/dev/null 2>&1; then
  if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
    nohup cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" \
      >>"$LOG_DIR/cloudflared.log" 2>&1 &
  else
    nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${LAYER_PORT}" \
      >>"$LOG_DIR/cloudflared.log" 2>&1 &
  fi
fi

exit 0
