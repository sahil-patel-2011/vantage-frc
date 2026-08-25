# Self-hosted storage node

A storage node is an always-on computer your team runs — a Raspberry Pi in the shop is the
canonical choice, but any Linux/macOS/Windows box with Node.js 20+ works. It stores your team's
large binary files (media, exports, scans) on its own disk so the hosted database never maxes
out: **only metadata (sha256, size, content type, which node) lives in the cloud; the bytes
live on your hardware.**

The service is a single stdlib-only file: `packages/storage-node/server.mjs`. No `npm install`,
no dependencies.

## How it works (and what it honestly cannot do)

- **Pairing** mirrors the Vantage CAD relay: the node asks the cloud for an 8-character code, a
  team **owner or admin** enters it at `/team/storage`, and the cloud issues the node a token.
  The cloud stores only the token's sha256 hash.
- **Heartbeats**: every 60 seconds the node reports real disk stats and verifies a batch of the
  items the cloud believes it holds (an incremental scrub). A heartbeat gap over 5 minutes shows
  the node as **degraded** on `/team/storage`; over 30 minutes, **offline**. Items on an
  unreachable node are shown as *"stored on `<node>`, currently unreachable"* with the last-seen
  time — never silently hidden, never faked as available.
- **Serving**: the node exposes `PUT/GET/HEAD/DELETE /items/<sha256>` (plus `/health`), with
  Range support for media playback. Every request needs the node's access key, which the cloud
  hands only to signed-in members of your team (`resolve-item`). Writes are verified against the
  URL's sha256 — corrupt or mismatched uploads are rejected, nothing partial is kept.
- **Quota**: the node enforces a disk quota (`--quota-gb`, default 20) and refuses writes past
  it with an honest HTTP 507 — it will not fill your SD card.

### The networking truth

- **On the same LAN** (shop, pit Wi-Fi with the Pi plugged into it), devices reach the node
  directly at `http://<pi-address>:8788`. The node reports its LAN addresses in heartbeats and
  the team page shows them.
- **From anywhere else, the cloud cannot reach a node behind your router.** There is no relay
  and no magic. If you want files available away from the LAN, give the node a public URL and
  paste it into its card on `/team/storage`. Two sane options:
  - **Tailscale Funnel** — `tailscale funnel 8788` gives you a stable
    `https://<machine>.<tailnet>.ts.net` URL. Easiest, free for this use.
  - **cloudflared** — `cloudflared tunnel --url http://localhost:8788` (quick tunnel) or a named
    tunnel on your own domain.
  Until a reachable URL is set, `resolve-item` returns `node-unreachable` with reason
  `no-public-url`, and the UI says so plainly.

## Raspberry Pi setup

1. **Flash** Raspberry Pi OS Lite (64-bit) with Raspberry Pi Imager; set a hostname, user, and
   enable SSH in the imager's settings. Boot and SSH in.
2. **Install Node.js 20+** (Raspberry Pi OS's default may be older):

   ```sh
   sudo apt-get update && sudo apt-get install -y curl
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node --version   # v22.x
   ```

3. **Get the service file** — copy `packages/storage-node/server.mjs` from the Vantage repo onto
   the Pi (it is one file):

   ```sh
   mkdir -p ~/vantage-storage-node
   # from your laptop:
   scp packages/storage-node/server.mjs pi@<pi-address>:vantage-storage-node/
   ```

4. **Pair** (interactive-free — everything is flags; the only human step is a teammate entering
   the code on the website):

   ```sh
   cd ~/vantage-storage-node
   node server.mjs --setup --cloud https://your-vantage-host --name pi-shop --quota-gb 100 \
     --dir /var/lib/vantage-storage
   ```

   It prints a code like `AB2D-EFGH`. A team owner/admin opens `/team/storage`, enters the code,
   and the node finishes pairing by itself. The config (including this node's private token) is
   saved with mode 0600 under the data directory.

   > `--dir /var/lib/vantage-storage` needs to exist and be writable:
   > `sudo mkdir -p /var/lib/vantage-storage && sudo chown $USER /var/lib/vantage-storage`

5. **Run**:

   ```sh
   node server.mjs --dir /var/lib/vantage-storage
   ```

   The node logs its LAN URLs and starts heartbeating. Check `/team/storage` — the node should
   show **Online** with real disk numbers within a minute.

6. **Autostart (systemd)** — a ready unit ships next to the server:

   ```sh
   sudo cp packages/storage-node/vantage-storage-node.service /etc/systemd/system/
   sudo nano /etc/systemd/system/vantage-storage-node.service   # adjust User= and paths
   sudo systemctl daemon-reload
   sudo systemctl enable --now vantage-storage-node
   systemctl status vantage-storage-node
   ```

## Flags

| Flag | Meaning | Default |
| --- | --- | --- |
| `--setup` | Pair this machine (prints the 8-char code) | — |
| `--cloud URL` | Hosted Vantage app URL (required with `--setup`) | — |
| `--name NAME` | Name shown to the team | machine hostname |
| `--dir DIR` | Data directory (config + items) | `$VANTAGE_STORAGE_DIR` or `./vantage-storage` |
| `--port N` | HTTP port | `8788` |
| `--quota-gb N` | Disk quota for stored items | `20` |

## On-disk layout

```
<dir>/config.json          # cloud URL, node token, access-key hash (mode 0600)
<dir>/items/ab/cd/abcd…    # content-addressed files, sharded by sha256 prefix
<dir>/items/ab/cd/abcd….json  # sidecar: content type, size, stored-at
<dir>/tmp/                 # in-flight uploads (cleared on boot)
```

Items are content-addressed: the filename **is** the sha256 of the bytes, verified on every
write. Restoring a node is just copying the `items/` tree back.

## Unpairing / decommissioning

On `/team/storage`, **Unpair node** revokes the node's token immediately: heartbeats stop being
accepted and every registered item on it is treated as unreachable (the metadata stays until you
remove it). The node itself keeps serving its LAN until you stop the service — wipe
`<dir>/config.json` and the `items/` tree to fully decommission.

## Cloud API surface (for feature integration)

- `POST /api/storage-node/pair/start|poll` — node-side pairing (unauthenticated, rate-limited).
- `POST /api/storage-node/pair/approve` — owner/admin approves a code.
- `POST /api/storage-node/heartbeat` — node token auth; liveness + disk + scrub.
- `GET/POST /api/storage-node` — team view; rename / set-base-url / unpair.
- `POST /api/storage-node/items` — `register-item`, `resolve-item`, `remove-item`.
  `resolve-item` returns `{status:"ok", url, accessKey}` only when the node has a reachable URL
  and a recent heartbeat; otherwise `node-unreachable` (with reason and LAN hints),
  `missing-on-node`, or `not-found` — callers must show those states, not paper over them.
