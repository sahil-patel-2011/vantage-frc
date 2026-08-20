---
name: cad-connectors
description: >-
  Connect Claude Code in the terminal to Onshape (API keys) or Fusion 360
  (local VantageCadRelay). Use when the user wants CAD from Claude Code, MCP
  vantage-cad tools, vantage-cad onshape/fusion commands, or setup for
  ONSHAPE_ACCESS_KEY / VantageCadRelay.
---

# Claude Code → Onshape / Fusion

Use the **vantage-cad MCP** tools. Do not invent geometry. Prefer a **disposable** document.

## First call

1. `cad_status` — see which CAD is ready.
2. If Onshape `setupRequired`, tell the user to create keys at https://dev-portal.onshape.com/keys and set `ONSHAPE_ACCESS_KEY` + `ONSHAPE_SECRET_KEY` in the terminal (never paste secrets into chat).
3. If Fusion is wanted on Windows/macOS: Fusion app open + **VantageCadRelay** add-in running. Linux has no Fusion — use Onshape.

## Onshape

1. `onshape_list_documents`
2. `onshape_list_elements` with document + default workspace
3. `onshape_bind` the Part Studio
4. `onshape_sketch_rectangle` (mm) then `onshape_extrude` (mm)
5. `onshape_describe` to confirm the feature tree

## Fusion

1. `fusion_status` must be reachable on `127.0.0.1:32145`
2. `fusion_sketch_rectangle` then `fusion_extrude`
3. `fusion_describe`

## Rules

- Dimensions are millimeters unless the user says otherwise.
- Never claim certified engineering or competition-legal CAD.
- Never log or repeat API secrets.
- Web OAuth (`ONSHAPE_OAUTH_*` on Vercel) is a different path from these terminal API keys.
