---
name: cad-fusion
description: >-
  Drive Vantage CAD → Autodesk Fusion 360 via the local relay (vantage-cad CLI +
  fusion360-official-connector). Use when pairing desktops, installing the Fusion
  add-in on Windows/macOS, debugging relay jobs, or explaining that Fusion is
  never hosted on Vercel. Linux has no Fusion app — use mock or Onshape instead.
---

# Vantage CAD → Fusion 360 (local relay)

## Architecture (locked)

- **Fusion 360 is local only.** Vantage/Vercel signs approved, expiring job envelopes.
- The paired **`vantage-cad`** CLI claims jobs and POSTs them to the Fusion add-in on **loopback** (`http://127.0.0.1:32145`).
- Never claim hosted Fusion, Autodesk cloud control from Vercel, or Linux Fusion support.

## OS matrix

| OS | CLI | Fusion Autodesk app | Vantage add-in |
|----|-----|---------------------|----------------|
| Windows | Yes | Yes | Yes |
| macOS | Yes | Yes | Yes |
| Linux | Yes | **No** | **No** — use Onshape or `VANTAGE_CAD_MOCK=1` |

## Install

```bash
# CLI (all OS)
bash scripts/cad/install-cli.sh          # macOS/Linux
# powershell -File .\scripts\cad\install-cli.ps1   # Windows

# Fusion add-in (Win/mac only)
bash scripts/cad/install-fusion-addin.sh
# powershell -File .\scripts\cad\install-fusion-addin.ps1
```

Add-in source: `packages/fusion360-official-connector/VantageCadRelay/`

Optional package (unsigned): `node scripts/cad/package-relay.mjs` → `dist/cad-relay/`

## Pair + run

1. `export VANTAGE_URL=https://vantage-frc-web.vercel.app` (or local `http://localhost:3001`)
2. `vantage-cad setup` → approve code at `/cad/pair` for **Fusion 360**
3. Open Fusion → run **VantageCadRelay** add-in
4. `vantage-cad start` (keep running)
5. In Vantage CAD Builder: create Fusion job → confirm brief → plan → approve steps
6. Relay claims approved steps automatically

Mock without Autodesk: `VANTAGE_CAD_MOCK=1 vantage-cad start`

## Secrets

- `FUSION_RELAY_SIGNING_SECRET` must match between Vantage server and the Fusion add-in process env (default local secret is for demos only).
- Device token stored via OS keychain/`~/.vantage-cad/credentials.json` — never commit.

## Agent rules

- Mutations require human approval in the web UI (allowlisted ops only).
- Implemented add-in ops today: `create_sketch`, `create_extrude`, `verify_*` / checkpoint / render.
- Other allowlisted ops return a clear not-implemented error — do not fake geometry.
- Terminal CLI brain = `$0` Vantage model charge (`key_source=local_cli`); still not certified engineering.

## Docs

See `CAD_RELAY.md` and the Fusion connector README.
