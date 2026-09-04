# Operate the Pi layer through Raspberry Pi Connect

Raspberry Pi Connect (`https://connect.raspberrypi.com`) is how you reach the
Pi 5 to install and debug the FreeBuff layer. It is **not** the inbound path
for team chat. A Connect remote shell is an interactive session that goes away
when you close the tab. Vercel needs a stable hostname — that is still the
Cloudflare tunnel in `docs/FREE_RELAY_PI.md`.

```
you  --browser-->  connect.raspberrypi.com  --remote shell-->  Pi 5
Vantage (Vercel)  --tunnel-->  127.0.0.1:8080 (this layer)  --loopback-->  Freebuff Coder UI /v1
```

## One-time on the Pi

On the Pi itself (keyboard, or an existing SSH):

```sh
sudo apt update && sudo apt install -y rpi-connect
rpi-connect on
rpi-connect signin
```

Open the URL it prints, link the device to your Raspberry Pi ID. After that the
Pi 5 shows up on the Connect Devices tab.

## Install the layer from Connect

1. Sign in at `https://connect.raspberrypi.com`.
2. Devices → your Pi 5 → **Connect via** → **Remote shell**.
3. Paste:

Sign in **once on the Pi** with `npx --yes @codebuff/cli login`. That file is the
session. Do not paste a FreeBuff token, do not start a Docker impersonator, and
do not run the relay on your laptop. After `pi-status.sh` is all OK, close
Connect and shut the laptop.

```sh
bash -lc 'curl -fsSL https://raw.githubusercontent.com/sahil-patel-2011/vantage-frc/main/scripts/pi/connect-bootstrap.sh | bash'
```

If the repo is already on the box:

```sh
cd ~/vantage-frc
bash scripts/pi/connect-bootstrap.sh
```

If Coder UI’s local `/v1` is not on `:3457`, set `FREEBUFF_UPSTREAM_URL` first.

## What should be running afterward

| Process | Bind | Role |
| --- | --- | --- |
| Freebuff Coder UI | usually `127.0.0.1:3457` | Official signed-in session. Exposes `/v1`. |
| `vantage-pi-layer` | `127.0.0.1:8080` | OpenAI-compatible front door. Requires `FREE_RELAY_API_KEY`. |
| `vantage-free-relay` | outbound only | Background sweep of `free_relay_jobs`. |

```sh
curl -sS http://127.0.0.1:8080/healthz
curl -sS http://127.0.0.1:8080/v1/models -H "Authorization: Bearer $FREE_RELAY_API_KEY"
```

A request without the bearer key must be refused.

## Then the tunnel

Connect cannot replace this. From the same remote shell (use `tmux` so the
session survives a dropped Connect tab):

```sh
cloudflared tunnel run --url http://127.0.0.1:8080 vantage-relay
```

Set `FREE_RELAY_BASE_URL` / `FREE_RELAY_API_KEY` / `FREE_RELAY_MODEL` on Vercel
as in `docs/FREE_RELAY_PI.md`.
