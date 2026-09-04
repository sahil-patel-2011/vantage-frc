#!/usr/bin/env bash
# Paste this into a Raspberry Pi Connect *remote shell* on the Pi 5.
#
# Connect is how you reach the box. It is not how Vantage reaches the box —
# team chat still needs the Cloudflare tunnel after this finishes.
set -euo pipefail

REPO_DIR="${VANTAGE_REPO:-$HOME/vantage-frc}"
REPO_URL="${VANTAGE_REPO_URL:-https://github.com/sahil-patel-2011/vantage-frc.git}"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$1" >&2; }
die() { printf '\033[31mxx %s\033[0m\n' "$1" >&2; exit 1; }

say "Vantage Pi layer — Raspberry Pi Connect bootstrap"

# ------------------------------------------------------------------ packages
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  say "Installing git + curl"
  sudo apt-get update -y
  sudo apt-get install -y git curl ca-certificates
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# ------------------------------------------------------------------ repo
if [ -d "$REPO_DIR/.git" ]; then
  say "Updating $REPO_DIR"
  git -C "$REPO_DIR" pull --ff-only
else
  say "Cloning $REPO_URL → $REPO_DIR"
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

# ------------------------------------------------------------------ Coder UI
say "Session is Freebuff Coder UI on this box — no Docker proxy, no pasted auth token."
warn "Leave Coder UI signed in. Default /v1 is http://127.0.0.1:3457."
warn "Override with FREEBUFF_UPSTREAM_URL if the UI listens elsewhere."

# ------------------------------------------------------------------ install
cd "$REPO_DIR"
bash scripts/pi/install-free-relay.sh
bash scripts/pi/pi-status.sh

cat <<EOF

$(say "On this box")

  curl -sS http://127.0.0.1:8080/healthz
  bash scripts/pi/pi-status.sh

Sign in once if status says the official login is missing:
  npx --yes @codebuff/cli login

Then close Connect and shut the laptop. The Pi keeps Freebuff up.
Interactive team chat still needs cloudflared on THIS box
(docs/FREE_RELAY_PI.md) — Connect sessions are not a public URL.
EOF
