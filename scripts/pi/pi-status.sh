#!/usr/bin/env bash
# Print whether this Pi can serve Freebuff without a laptop attached.
# Never prints keys or tokens.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${FREE_RELAY_ENV_FILE:-$REPO_ROOT/.env.free-relay}"
LAYER_PORT="${FREE_RELAY_PROXY_PORT:-8080}"
SERVICE_USER="${SUDO_USER:-$USER}"
SERVICE_HOME="${HOME}"
if [ -n "${SUDO_USER:-}" ] && command -v getent >/dev/null 2>&1; then
  SERVICE_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6 || true)"
  [ -n "$SERVICE_HOME" ] || SERVICE_HOME="$HOME"
fi
CREDS="$SERVICE_HOME/.config/manicode/credentials.json"

ok() { printf '  OK  %s\n' "$1"; }
bad() { printf '  --  %s\n' "$1"; }

echo "Freebuff Pi autonomy — laptop can be off if every line is OK"
echo "user=$SERVICE_USER home=$SERVICE_HOME repo=$REPO_ROOT"

if [ -f "$ENV_FILE" ]; then
  ok "env file $ENV_FILE"
else
  bad "missing $ENV_FILE — run bash scripts/pi/install-free-relay.sh"
fi

if [ -f "$CREDS" ]; then
  ok "official Freebuff login on this box ($CREDS)"
else
  bad "no official login — run: npx --yes @codebuff/cli login   (once, on this Pi)"
fi

if curl -fsS -m 4 "http://127.0.0.1:${LAYER_PORT}/healthz" >/dev/null 2>&1; then
  ok "Pi layer answering on 127.0.0.1:${LAYER_PORT}"
else
  bad "Pi layer down — start vantage-pi-layer or: npm run free-relay:serve"
fi

if pgrep -f "[c]loudflared" >/dev/null 2>&1; then
  ok "cloudflared tunnel process is running"
else
  bad "cloudflared is not running — inbound chat from Vercel will fail"
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user is-active --quiet vantage-pi-layer.service 2>/dev/null; then
    ok "user unit vantage-pi-layer is active"
  elif systemctl is-active --quiet vantage-pi-layer.service 2>/dev/null; then
    ok "system unit vantage-pi-layer is active"
  else
    bad "no vantage-pi-layer systemd unit active"
  fi
  if loginctl show-user "$SERVICE_USER" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
    ok "linger enabled — user services start at boot without a login"
  else
    bad "linger off — after reboot nothing starts until someone logs in"
    echo "      fix: sudo loginctl enable-linger $SERVICE_USER"
  fi
fi

if crontab -l 2>/dev/null | grep -q 'keep-tunnel.sh'; then
  ok "cron keep-alive installed (survives if systemd user units do not)"
else
  bad "no cron keep-alive — installer adds one as a fallback"
fi

echo
echo "This box does not need your laptop. Vercel reaches it through the tunnel."
echo "Shut the laptop. Leave the Pi plugged in with home internet."
