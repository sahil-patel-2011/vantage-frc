#!/usr/bin/env bash
# Install Pi services so Freebuff keeps running after you close Connect
# and shut the laptop. Safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${FREE_RELAY_ENV_FILE:-$REPO_ROOT/.env.free-relay}"
LAYER_PORT="${FREE_RELAY_PROXY_PORT:-8080}"
NPM_BIN="$(command -v npm)"
CF_BIN="$(command -v cloudflared || true)"

if [ "$(id -u)" = "0" ] && [ -n "${SUDO_USER:-}" ]; then
  SERVICE_USER="$SUDO_USER"
else
  SERVICE_USER="$USER"
fi
SERVICE_HOME="$(getent passwd "$SERVICE_USER" 2>/dev/null | cut -d: -f6 || true)"
[ -n "$SERVICE_HOME" ] || SERVICE_HOME="$HOME"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$1" >&2; }

write_unit() {
  local dest="$1"
  cat >"$dest"
}

layer_unit() {
  cat <<EOF
[Unit]
Description=Vantage Pi layer (OpenAI-compatible front door for FreeBuff)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
Environment=HOME=$SERVICE_HOME
EnvironmentFile=$ENV_FILE
ExecStart=$NPM_BIN run free-relay:serve
Restart=always
RestartSec=10
$1

[Install]
WantedBy=${2:-default.target}
EOF
}

sweep_unit() {
  cat <<EOF
[Unit]
Description=Vantage free-relay background sweep (outbound only)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
Environment=HOME=$SERVICE_HOME
EnvironmentFile=$ENV_FILE
ExecStart=$NPM_BIN run free-relay:daemon
Restart=always
RestartSec=30
$1

[Install]
WantedBy=${2:-default.target}
EOF
}

tunnel_unit() {
  local after="$1"
  local extra="$2"
  local wanted="${3:-default.target}"
  cat <<EOF
[Unit]
Description=Vantage Freebuff Cloudflare tunnel
After=network-online.target $after
Wants=network-online.target

[Service]
Type=simple
Environment=HOME=$SERVICE_HOME
EnvironmentFile=-$ENV_FILE
ExecStart=/bin/sh -c 'if [ -n "\$CLOUDFLARE_TUNNEL_TOKEN" ]; then exec $CF_BIN tunnel --no-autoupdate run --token "\$CLOUDFLARE_TUNNEL_TOKEN"; else exec $CF_BIN tunnel --no-autoupdate --url http://127.0.0.1:$LAYER_PORT; fi'
Restart=always
RestartSec=5
$extra

[Install]
WantedBy=$wanted
EOF
}

say "Installing units that survive logout and reboot (user=$SERVICE_USER)"

if [ "$(id -u)" = "0" ]; then
  layer_unit "User=$SERVICE_USER" "multi-user.target" >/etc/systemd/system/vantage-pi-layer.service
  sweep_unit "User=$SERVICE_USER" "multi-user.target" >/etc/systemd/system/vantage-free-relay.service
  if [ -n "$CF_BIN" ]; then
    tunnel_unit "vantage-pi-layer.service" "User=$SERVICE_USER" "multi-user.target" >/etc/systemd/system/vantage-cloudflared.service
  fi
  systemctl daemon-reload
  systemctl enable --now vantage-pi-layer.service
  systemctl enable --now vantage-free-relay.service
  if [ -n "$CF_BIN" ]; then
    systemctl enable --now vantage-cloudflared.service
  fi
  echo "  system units enabled as $SERVICE_USER (HOME=$SERVICE_HOME)"
else
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  layer_unit "" >"$UNIT_DIR/vantage-pi-layer.service"
  sweep_unit "" >"$UNIT_DIR/vantage-free-relay.service"
  if [ -n "$CF_BIN" ]; then
    tunnel_unit "vantage-pi-layer.service" "" >"$UNIT_DIR/vantage-cloudflared.service"
  fi
  systemctl --user daemon-reload
  systemctl --user enable --now vantage-pi-layer.service
  systemctl --user enable --now vantage-free-relay.service
  if [ -n "$CF_BIN" ]; then
    systemctl --user enable --now vantage-cloudflared.service
  fi
  echo "  user units enabled under $UNIT_DIR"
  if command -v loginctl >/dev/null 2>&1; then
    if loginctl show-user "$SERVICE_USER" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
      echo "  linger already on"
    elif sudo -n loginctl enable-linger "$SERVICE_USER" 2>/dev/null; then
      echo "  linger enabled — services start at boot with nobody logged in"
    else
      warn "Enable linger so reboot does not wait for a login:"
      warn "  sudo loginctl enable-linger $SERVICE_USER"
    fi
  fi
fi

if [ -z "$CF_BIN" ]; then
  warn "cloudflared is not on PATH. Inbound Vercel chat needs it on this Pi, not the laptop."
  warn "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
fi

CRON_LINE="*/2 * * * * $REPO_ROOT/scripts/pi/keep-tunnel.sh"
if command -v crontab >/dev/null 2>&1; then
  EXISTING="$(crontab -u "$SERVICE_USER" -l 2>/dev/null || crontab -l 2>/dev/null || true)"
  if printf '%s\n' "$EXISTING" | grep -Fq "keep-tunnel.sh"; then
    echo "  cron keep-alive already installed"
  else
    { printf '%s\n' "$EXISTING"; printf '%s\n' "$CRON_LINE"; } | {
      if [ "$(id -u)" = "0" ]; then
        crontab -u "$SERVICE_USER" -
      else
        crontab -
      fi
    }
    echo "  cron keep-alive every 2 minutes (survives if a unit exits)"
  fi
fi

CREDS="$SERVICE_HOME/.config/manicode/credentials.json"
if [ -f "$CREDS" ]; then
  echo "  official Freebuff login present — Coder UI GUI is optional"
else
  warn "Sign in once ON THIS PI (not the laptop):"
  warn "  npx --yes @codebuff/cli login"
  warn "Credentials stay in $CREDS. After that the Pi talks to Freebuff by itself."
fi
