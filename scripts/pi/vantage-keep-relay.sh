#!/bin/bash
LAYER=8080
REPO="$HOME/vantage-frc"
mkdir -p "$HOME/.local/state/vantage-freebuff"
if ! curl -fsS -m 3 "http://127.0.0.1:${LAYER}/healthz" >/dev/null; then
  cd "$REPO" && nohup npm run free-relay:serve >>"$HOME/.local/state/vantage-freebuff/pi-layer.log" 2>&1 &
fi
if ! pgrep -f "[c]loudflared" >/dev/null; then
  nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${LAYER}" >>/tmp/cloudflared.log 2>&1 &
fi
