# Claude Code → Onshape / Fusion 360

Drive real CAD from the terminal. Claude Code calls Vantage's CAD tools over MCP; the tools call
Onshape's REST API or your local Fusion add-in. There is no mock geometry — every sketch, extrude,
fillet and hole in this document lands in a real document.

This is **not** the Vantage web OAuth path and **not** a second backend. The web `/cad` page and this
CLI run the *same* tool implementations (`packages/cad/src/claude-cad.ts`); they differ only in how
they authenticate and where they store the session binding.

| CAD | Where it runs | What you need |
|-----|---------------|----------------|
| **Onshape** | Onshape cloud, any OS | An API key pair in this terminal |
| **Fusion 360** | Your PC only | Fusion app + VantageCadRelay add-in on `127.0.0.1:32145` |

Linux: Onshape only. Autodesk Fusion is not available on Linux — use `VANTAGE_CAD_MOCK=1` if you only
need to exercise the relay protocol.

> Not certified engineering software. Use a **disposable** document the first time. Never point a
> first run at the competition robot.

---

## 1. Onshape in five minutes

1. Open [dev-portal.onshape.com/keys](https://dev-portal.onshape.com/keys) and create an API key pair.
2. Put it in this terminal (this session only — never commit it, never paste it into chat):

   ```powershell
   # PowerShell
   $env:ONSHAPE_ACCESS_KEY="your-access-key"
   $env:ONSHAPE_SECRET_KEY="your-secret-key"
   ```

   ```bash
   # bash / zsh
   export ONSHAPE_ACCESS_KEY=your-access-key
   export ONSHAPE_SECRET_KEY=your-secret-key
   ```

   `ONSHAPE_API_KEY` / `ONSHAPE_API_SECRET` work as aliases.

3. In Onshape, create a disposable document with one Part Studio.
4. Check the wiring:

   ```text
   npx vantage-cad doctor
   ```

5. Ask Claude Code:

   > list my Onshape documents, bind the disposable Part Studio, then build an 80×50×6 mm plate with
   > 5 mm corner fillets and a 4× row of 5 mm holes on 20 mm pitch

   That brief decomposes into `onshape_sketch_rectangle` → `onshape_extrude` → `onshape_fillet` →
   `onshape_sketch_points` → `onshape_hole`. You will see each step narrated with the dimensions it
   actually used.

### Binding

Every Onshape tool works on the **bound Part Studio**. `onshape_bind` stores the document, workspace
and element ids in `~/.vantage-cad/claude-session.json` (ids only, never secrets) and everything after
that edits that Part Studio until you bind another one.

Binding also scopes **undo**: `onshape_delete_feature` will only delete a feature that Vantage created
in the current binding. It refuses to touch hand-built history, so it can never eat someone's work.

---

## 2. Fusion 360 (Windows / macOS)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-windows.ps1
```

Then in Fusion: **Utilities → Add-Ins → Scripts and Add-Ins → run VantageCadRelay**. Keep Fusion open
with a design loaded. The add-in listens on loopback only and refuses any job whose signed envelope
does not verify.

```text
npx vantage-cad fusion ping
npx vantage-cad fusion sketch --width 40 --height 20
npx vantage-cad fusion extrude --depth 10
```

### What Fusion can and cannot do

The Fusion add-in (`packages/fusion360-official-connector`) implements **eight** operations:
`create_sketch`, `create_extrude`, `create_fillet`, `create_chamfer`, `delete_feature`,
`verify_topology`, `render_views`, `create_checkpoint`.

Anything else is **Onshape only** — holes, patterns, mirror and polyline sketches. The tool list says
so up front (`cad_tools`, and the Tools panel on `/cad`) rather than letting the agent discover it
halfway through a build.

Two operations behave differently on the two platforms, and the tool list says that too:

- **Fillet / chamfer.** Onshape can round just the corner edges of a plate (`selection='corners'`).
  The Fusion relay rounds *every* edge of the most recent body.
- **Circle sketch.** Onshape can put many circles in one sketch. The Fusion relay draws one.

The add-in publishes its own operation list on `GET /health`. `vantage-cad doctor` compares that list
against what this build of Vantage expects and tells you to run `vantage-cad update` if they differ —
version skew is reported before a build, not during one.

---

## 3. Claude Code MCP

This repo ships `.mcp.json`. Restart Claude Code in the repo root, or register it by hand:

```text
claude mcp add vantage-cad -- node packages/vantage-cad-cli/bin/vantage-cad.mjs mcp
```

Every tool in the table below is then callable from Claude Code.

---

## 4. Every tool

`cad_tools` prints this same table at runtime, generated from the same source
(`packages/cad/src/cad-tool-catalog.ts`), so it can never drift from what the agent can actually run.

| Tool | Onshape | Fusion | What it does |
|------|:-------:|:------:|--------------|
| `cad_status` | yes | yes | Show whether Onshape API keys and the local Fusion add-in are ready, plus the bound Part Studio. |
| `cad_setup` | yes | yes | Return short setup steps for Onshape API keys and the Fusion 360 local add-in. |
| `cad_tools` | yes | yes | List every CAD operation with its Onshape / Fusion support, so nothing is attempted blind. |
| `onshape_list_documents` | yes | — | List recent Onshape documents for the connected account. <br>_Fusion works on the design that is already open — there is no document list to browse._ |
| `onshape_list_elements` | yes | — | List elements (Part Studios) in an Onshape document workspace. <br>_Fusion works on the design that is already open._ |
| `onshape_bind` | yes | — | Remember the Part Studio this session edits. Use a disposable document, never the competition robot. <br>_The Fusion relay always targets the active design._ |
| `onshape_describe` | yes | yes | List the features in the bound Part Studio, newest last, with plain-English explanations. |
| `onshape_sketch_rectangle` | yes | yes | Add a rectangle sketch on Front/Top/Right. Dimensions in millimetres. |
| `onshape_sketch_circle` | yes | yes | Add a sketch with one or more circles (bosses, bores, standoffs). For fastener holes prefer `onshape_hole`. <br>_Fusion draws one circle per sketch; the multi-circle `circles` array is Onshape only._ |
| `onshape_sketch_polyline` | yes | — | Sketch from explicit mm points — open path or closed polygon (gussets, bellypan outlines, non-rectangular plates). <br>_The Fusion add-in sketches rectangles and circles only._ |
| `onshape_sketch_points` | yes | — | Sketch bare points. These are the drill locations `onshape_hole` consumes. <br>_Hole points are part of the Onshape hole workflow; the Fusion add-in has no hole tool._ |
| `onshape_extrude` | yes | yes | Extrude a sketch region. NEW makes a body, REMOVE cuts, ADD merges. Depth in millimetres. |
| `onshape_fillet` | yes | yes | Round edges. `selection='corners'` rounds only the plate corners; `'all'` rounds every edge. <br>_Fusion rounds every edge of the most recent body — corners-only is Onshape only._ |
| `onshape_chamfer` | yes | yes | Bevel edges by an equal-offset width in millimetres. <br>_Fusion bevels every edge of the most recent body — corners-only is Onshape only._ |
| `onshape_hole` | yes | — | Drill a real Hole feature at the points of a point sketch. THROUGH by default; BLIND needs `depthMm`. <br>_The Fusion add-in has no hole tool — cut circles with a sketch + extrude REMOVE instead._ |
| `onshape_linear_pattern` | yes | — | Repeat whole features along an axis — bolt rows, rib arrays. <br>_Pattern features are Onshape only._ |
| `onshape_circular_pattern` | yes | — | Repeat whole features around a cylindrical face — spoke and bolt-circle patterns. <br>_Pattern features are Onshape only._ |
| `onshape_mirror` | yes | — | Mirror whole features across a standard plane — keeps left/right subassemblies symmetric. <br>_Mirror is Onshape only._ |
| `onshape_delete_feature` | yes | yes | Undo a feature *this session* created. Refuses to touch features it did not add. <br>_On Fusion, undo history resets when the add-in restarts._ |
| `fusion_status` | — | yes | Ping the local VantageCadRelay add-in on loopback. |
| `fusion_describe` | — | yes | Verify the open Fusion design (body / feature counts). |
| `fusion_sketch_rectangle` | — | yes | Rectangle sketch in the active Fusion design. Millimetres. |
| `fusion_sketch_circle` | — | yes | Circle sketch in the active Fusion design. Diameter in millimetres. |
| `fusion_extrude` | — | yes | Extrude the latest Fusion sketch. Depth in millimetres. |
| `fusion_fillet` | — | yes | Round every edge of the most recent Fusion body. <br>_No corners-only selection in the relay._ |
| `fusion_chamfer` | — | yes | Bevel every edge of the most recent Fusion body. <br>_No corners-only selection in the relay._ |
| `fusion_undo_last` | — | yes | Delete the most recent feature the relay created. <br>_Only its own features, and only while the add-in stays running._ |

### How the tools chain

Mutating tools return a `featureId`, and each tool defaults to the right previous feature, so you
rarely pass ids by hand:

- **Flat plate** — `onshape_sketch_rectangle` → `onshape_extrude` (depth = stock thickness).
- **Rounded corners** — `onshape_fillet` right after the extrude; it resolves that extrude's real
  corner edges.
- **Bolt row / hole grid** — `onshape_sketch_points` (explicit points, or `gridCountX` +
  `gridPitchXMm`) → `onshape_hole`. One hole feature covers every point; do not pattern it.
- **Pocket / cutout** — sketch the profile, then `onshape_extrude` with `operationType='REMOVE'`.
- **Round boss or bore** — `onshape_sketch_circle` → `onshape_extrude` (ADD or REMOVE).
- **Non-rectangular outline** — `onshape_sketch_polyline` with `closed=true`.
- **Repeat something** — `onshape_linear_pattern`, `onshape_circular_pattern`, or `onshape_mirror`.
- **Wrong step** — `onshape_delete_feature`.

Selections are never guessed. Edges, faces and vertices are resolved by evaluating a read-only
FeatureScript query against the real model first (`packages/cad/src/onshape-resolve.ts`); if nothing
matches, the tool says so and changes nothing rather than guessing an id.

---

## 5. CLI commands

```text
vantage-cad <setup|start|status|doctor|update|logout|claude|mcp|onshape|fusion>
```

| Command | What it does |
|---------|--------------|
| `vantage-cad claude` | Print setup instructions and the current status. Start here. |
| `vantage-cad doctor` | Full preflight, `[PASS/WARN/FAIL]` per line. Exit code 1 on any FAIL — safe for CI. `--json` for machine output. |
| `vantage-cad setup` | Pair this machine with your team's Vantage org so terminal CAD shows up on `/cad`. |
| `vantage-cad status` | Platform, binding, login state, sync state. |
| `vantage-cad start` | Run the relay bridge (and the in-process mock plugin under `VANTAGE_CAD_MOCK=1`). |
| `vantage-cad update` | Reinstall the CLI and the Fusion add-in so both match the server. |
| `vantage-cad logout` | Forget this device's pairing. |
| `vantage-cad mcp` | Speak MCP on stdio — what `.mcp.json` runs. |
| `vantage-cad onshape docs\|elements\|bind\|describe\|sketch\|extrude` | Direct Onshape subcommands. |
| `vantage-cad fusion ping\|describe\|sketch\|extrude` | Direct Fusion subcommands. |

The `onshape` and `fusion` subcommands are a convenience shortcut for the most common operations. The
**full** toolbox — fillet, chamfer, hole, patterns, mirror, undo — is reached through Claude Code
(MCP) or the `/cad` web agent, not through flags.

### `vantage-cad doctor`

Doctor is the one command to run when something is wrong. It checks, in order: Node version, OS
capability matrix, credential storage, device pairing, Vantage URL reachability, relay protocol
compatibility, relay heartbeat, Onshape OAuth env, Onshape API keys, Onshape execution path, Fusion
prerequisites, Fusion relay health, **Fusion operation parity**, mock mode, team-sync freshness, and
the CLI state directory.

Every non-passing line names the exact command that fixes it — `vantage-cad setup`,
`vantage-cad update`, `vantage-cad logout`, or the env var to set. Exit code is `0` when nothing
failed and `1` otherwise, so CI can gate on it:

```text
npx vantage-cad doctor --json
```

---

## 6. Team sync

If you run `vantage-cad setup`, each CAD tool call is reported to your team's Vantage org and appears
in **Recent CAD activity** on `/cad`, alongside sessions run from the web agent. Rows can be filtered
by who ran them (Everyone / Mine) and where they ran (All / Web / Terminal), and expanding a row shows
that session's steps.

Sync is best-effort and never blocks a CAD operation. Unpaired or offline, everything still works
locally; queued events flush on the next successful call. `vantage-cad doctor` reports the queue depth
and the age of the last successful sync.

---

## 7. The web agent (`/cad`)

The hosted agent runs the Onshape half of the same toolbox — Fusion needs a loopback relay on your PC,
so it can never run on the server. Three modes:

- **Simple** — one brief, one tool loop, one answer.
- **Plan** — the agent writes a numbered build plan and asks its questions *before* touching Onshape.
  You edit the steps, answer the questions, then Approve & build.
- **Multitask** — the brief is split into a checklist of sub-tasks worked one at a time through a
  single Onshape session. Sub-tasks share one step budget, so the cap is enforced overall.

The session pane shows the narrated build steps with per-step status — the same wording the terminal
prints — plus the bound document name and an "Open in Onshape" deep link.

---

## Safety

- Use a disposable document the first time. Undo only covers features Vantage added.
- Keys stay in the process environment. The session binding (`~/.vantage-cad/claude-session.json`)
  holds ids only, never secrets. Never paste API secrets into chat.
- The Fusion relay binds loopback only and verifies a signed envelope on every job.
- Fusion is never hosted on Vercel.
- Not certified engineering software: no stress analysis, no manufacturing certification, no
  competition-legal ruling.
