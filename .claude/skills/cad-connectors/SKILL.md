---
name: cad-connectors
description: >-
  Connect Claude Code in the terminal to Onshape (Playwright browser session or API keys) or Fusion 360
  (local VantageCadRelay). Use when the user wants CAD from Claude Code, MCP
  vantage-cad tools, vantage-cad onshape/fusion commands, or setup for
  vantage-cad login / ONSHAPE_ACCESS_KEY / VantageCadRelay.
---

# Claude Code → Onshape / Fusion

Use the **vantage-cad MCP** tools. Do not invent geometry. Prefer a **disposable** document.

## First call

1. `cad_status` — see which CAD is ready.
2. If Onshape `setupRequired`, first run `vantage-cad login`; the user signs into the visible Playwright window. API keys are an explicit fallback and consume the annual allowance.
3. If Fusion is wanted on Windows/macOS: Fusion app open + **VantageCadRelay** add-in running. Linux has no Fusion — use Onshape.

## Onshape

1. `onshape_list_documents`
2. `onshape_list_elements` with document + default workspace
3. `onshape_bind` the Part Studio
4. `onshape_sketch_rectangle` (mm) then `onshape_extrude` (mm)
5. `onshape_describe` to confirm the feature tree
6. For assemblies without FeatureScript: `onshape_body_details`, `onshape_create_assembly`,
   `onshape_add_assembly_instance`, `onshape_mate`, then `onshape_get_assembly`

### Everything the native path covers

Sketches (`rectangle`, `circle`, `polyline`, `points`), `onshape_extrude`, `onshape_revolve`,
`onshape_boolean`, `onshape_fillet`, `onshape_chamfer`, `onshape_shell`, `onshape_hole`,
`onshape_linear_pattern`, `onshape_circular_pattern`, `onshape_mirror`, `onshape_variable_list`,
`onshape_variable_set`, `onshape_delete_feature`, plus the assembly tools above.

Two need naming rather than guessing:

- `onshape_revolve` — `axisSketchFeatureId` must be a sketch with **exactly one** line (the
  centreline, in its own sketch).
- `onshape_shell` — `openFace` is the world direction the removed face points: `+Z` (default), `-Z`,
  `±X`, `±Y`.

Leave dimensions behind as variables (`onshape_variable_set`) whenever a number is likely to change.
A human retypes a variable; they cannot retype a hard-coded extrude as easily.

### Do not use the `cad_part_*` FeatureScript pipeline

It ships **disabled** and `cad_part_push` will refuse. It builds the part as one generated custom
feature, which a human cannot open, re-sketch, or insert a feature into. Build with the native tools
above instead. Only if the user explicitly asks for it, and accepts an uneditable part, does
`VANTAGE_CAD_ALLOW_FEATURESCRIPT=1` turn it back on.

## Fusion

1. `fusion_status` must be reachable on `127.0.0.1:32145`
2. `fusion_sketch_rectangle` then `fusion_extrude`
3. `fusion_describe`

## Rules

- Dimensions are millimeters unless the user says otherwise.
- Never claim certified engineering or competition-legal CAD.
- Never log or repeat API secrets.
- Local resolution order is Playwright browser session → OAuth → API keys. Never silently spend the API-key allowance.
- Web OAuth/server keys are hosted paths; the local browser session remains on the user's machine.
