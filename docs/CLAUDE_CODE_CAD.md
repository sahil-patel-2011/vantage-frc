# Claude Code → Onshape / Fusion 360

Drive real CAD from the terminal. Claude Code calls Vantage's CAD tools over MCP; the tools call
Onshape's REST API or your local Fusion add-in. There is no mock geometry — every feature in this
document lands in a real document.

There are **two toolsets** behind one MCP server, and they exist for different jobs:

| Toolset | What it is | When to use it |
|---------|-----------|----------------|
| **The part pipeline** (`cad_part_*`) | Local design-for-manufacturing checks, then ONE generated FeatureScript feature that builds the whole solid | Any printable part: plates, brackets, boxes, hole patterns, insert bosses |
| **The per-operation tools** (`onshape_*`, `fusion_*`) | One REST call per sketch / extrude / fillet | Poking at an existing model, Fusion work, anything the part schema cannot express |

> Not certified engineering software. Use a **disposable** document the first time. Never point a
> first run at the competition robot.

---

## 1. Why the pipeline exists: Onshape's allowance is annual

Onshape's published API-call limits are **per year**, pooled per company:

| Plan | Calls per year |
|------|----------------|
| Enterprise / Enterprise GOV | 10,000 per full user |
| Professional | 5,000 per user |
| EDU Student / Free / Standard | 2,500 per user |
| EDU Enterprise | 10,000 per enterprise |
| EDU Educator / Pro Discovery | 2,500 per company |

Source: <https://onshape-public.github.io/docs/auth/limits/> (verified 2026-08-25). Past the limit,
requests come back `402`.

The same page says which calls are **not** counted — "calls made from the Onshape browser, mobile
clients, or the Onshape API Explorer (when authenticated via an Onshape session)" — and that counted
sources are only charged when they return 2xx/3xx. Two consequences run through everything below:

1. **A signed-in browser session is the quota-free path.** `vantage-cad login` is what puts one on
   disk. API keys and OAuth are counted.
2. **One FeatureScript feature builds the whole part.** A plate with four counterbored holes and
   filleted corners costs the same two calls as a bare plate, because the holes are parameters of one
   custom feature rather than a REST call each.

A naive sketch → extrude → describe → render → fillet loop spends a call per operation and can burn a
season's allowance in an afternoon. That is the thing this design exists to prevent.

---

## 2. Setup: sign in, then reload MCP

```text
npx vantage-cad login
```

A real Chromium window opens on Onshape. You sign in yourself — password, SSO, 2FA, whatever your
school or team uses. Nothing is typed for you. When Onshape reports a signed-in user, the session
cookies are written to `~/.vantage-cad/onshape-session.json` with mode `0600`, and the CLI then proves
the saved session works **outside** the browser with one call to `/users/current`.

```text
npx vantage-cad login --status    # is a session saved, and what has this machine spent?
npx vantage-cad login --clear     # delete it
```

Then make Claude Code pick the tools up. The MCP tool list is read when the server connects, so a
session that was already running will not see them:

```text
claude mcp add vantage-cad -- node packages/vantage-cad-cli/bin/vantage-cad.mjs mcp
```

This repo also ships `.mcp.json` with that exact command, so from the repo root it is enough to start a
new Claude Code session. `/mcp` lists the connected servers — `vantage-cad` should be there with
**35 tools** (27 per-operation, 8 pipeline). If it is missing or the new tools are not listed, restart
Claude Code rather than retrying a tool call.

### What the browser-session path is, honestly

Onshape publishes no supported contract for a third-party process replaying browser session cookies
against `/api/`, and their Terms of Use prohibit accessing the service "by any robot, spider, scraper
or other automated means". This flow drives **your own account, in a window you signed into yourself,
at your own instruction** — but it is not an Onshape-blessed integration path, and that is a judgement
for the account owner to make. Nothing about the cookie names is hardcoded (every `onshape.com` cookie
the browser holds is stored), and expiry is detected from a real 401 or sign-in redirect rather than
guessed, because Onshape does not publish a cookie lifetime either.

If that trade is not one you want to make, use API keys and watch the ledger.

### API keys: the fallback that spends the allowance

```powershell
$env:ONSHAPE_ACCESS_KEY="your-access-key"; $env:ONSHAPE_SECRET_KEY="your-secret-key"
```

```bash
export ONSHAPE_ACCESS_KEY=your-access-key ONSHAPE_SECRET_KEY=your-secret-key
```

Keys come from <https://dev-portal.onshape.com/keys>. `ONSHAPE_API_KEY` / `ONSHAPE_API_SECRET` work as
aliases. **Every successful call on this path is deducted from the annual allowance above.** The tools
still work; they just say so in every result, and `cad_auth_status` names the path it resolved.

Resolution order is fixed: saved browser session → OAuth → API keys. A saved-but-expired session never
quietly falls through to a paid path — either it raises "run `vantage-cad login` again", or, if keys
are also configured, it uses them *and warns that the run is now spending the cap*.

---

## 3. The canonical flow

```text
cad_auth_status → cad_open_document → cad_part_check → cad_part_preview → cad_part_push → cad_part_verify
   0 or 1 call        1 call             0 calls           0 calls          2-4 calls        2 calls
                                         └─────── everything local happens here ───────┘
```

This order is **enforced by the tools, not just documented**:

- `cad_part_push` requires a `previewToken` from `cad_part_preview`, and that preview must trace back
  to a `cad_part_check` that did not fail. A preview built from a raw part is refused — the result
  says `status: "out_of_order"` and names the tool to call, and **no Onshape call is spent** finding
  that out.
- A `fail` from the local check blocks the push. You can override it, but only with
  `acknowledgeDfmFail: true` **and** `acknowledgedChecks` naming every failing rule, so it is a
  decision in the transcript rather than a silent one.
- Pushing the same part twice is refused, with a pointer to `cad_part_edit` (1 call) instead.
- `cad_part_edit` returns `no_change` for **0 calls** when every parameter in the edit already holds
  the requested value, so re-asserting a dimension never writes an identical parameter.
- `cad_part_verify` returns the previous readback for **0 calls** when nothing has changed since this
  session last verified that feature.
- Every result — including the free ones — carries `callBudget`: what this tool spent, whether that
  was charged to the annual cap, and the lifetime tally from this machine.
- Not being signed in is a **refusal, not a crash**: any tool that needs Onshape returns
  `status: "setup_required"` with `missing: "auth"` and the `vantage-cad login` command, still carrying
  the ledger. Nothing is charged either way — an unresolved credential never reaches Onshape, and a
  session Onshape rejects answers 4xx, which the limits page says is not counted.

Note that only the last two stages need a credential at all. `cad_part_check` and `cad_part_preview`
run to completion with Onshape entirely disconnected, which is what "local checks first" means in
practice rather than as an ordering convention.

### Ask, don't guess

When something load-bearing is missing, the tool returns `status: "needs_clarification"` with the exact
question and the options, and spends nothing:

| Missing | What it asks |
|---------|--------------|
| `printerId` | Lists the printer profiles (`bambu-x1c`, `bambu-p1s`, `bambu-p2s`, `bambu-h2d`, `bambu-h2s`, `snapmaker-u1`). Bed size, nozzle material and bead width all change the answer. |
| `materialId` | Lists `pla`, `petg`, `abs`, `asa`, `pa-cf`. Enclosure, abrasion and shrinkage follow from it. |
| `holeType` on a threaded hole | clearance / tapped / heat-set, **with the diameter each one implies** — an M3 is 3.4 mm as clearance, 2.5 mm tapped, and 4.0 mm as a heat-set bore. |
| A hole with neither `diameterMm` nor `thread` | Asks for one or the other. |
| A URL with no `/w/` workspace | Asks for the Part Studio tab's link, rather than spending a call to look the workspace up. |
| A document with several Part Studios | Asks which one, rather than binding to the first. |

Where a real default exists it is applied **and reported** in `defaultsApplied`, never silently:

- clearance `fit` defaults to **ISO 273 normal** (M3 → 3.4 mm), and the result says what close and
  loose would have been;
- a heat-set hole with no `insert` defaults to the **longest tabulated body** in that thread size, and
  the result names it and its installation-hole diameter;
- a heat-set hole with no depth defaults to **insert length + two thread pitches** (SPIROL's minimum),
  and the result says where that number came from.

### What the local check catches, at zero calls

Bed fit (including whether a rotation would save it), minimum wall against the real bead width,
hole-to-edge distance, heat-set bore depth and boss wall, overhang angle, features smaller than one
extrusion, nozzle abrasion, chamber and bed-temperature requirements, and hole-compensation
calibration. Rules with nothing to check are listed in `notApplicable`, so silence is never mistaken
for a pass.

It also answers the question that is easy to get wrong quietly: **what diameter to actually model.**
FDM prints holes undersized, so an M3 clearance hole with an ISO 273 nominal of 3.40 mm has to be
modelled at **3.62 mm** on a Bambu X1C in PLA with a 0.4 mm nozzle. `cad_part_check` returns the
compensated part, and that is the geometry `cad_part_push` builds. The three terms and their
provenance are in `packages/cad/src/dfm/hole-compensation.ts`; only PLA on a 0.4 mm Bambu nozzle is
fitted to a measured part, and every other combination reports `calibrated: false` and tells you to
print a coupon.

---

## 4. Worked example: 80 × 60 × 6 plate, M3 corner holes, X1C, PLA

> sign into Onshape, open this Part Studio <url>, then build an 80×60×6 mm plate with M3 clearance
> holes 10 mm in from each corner, for an X1C in PLA

| Step | Tool | Onshape calls |
|------|------|:-------------:|
| 1 | `cad_auth_status` with `verify: true` — prove the saved session still authenticates | 1 |
| 2 | `cad_open_document` — bind the Part Studio, find the Feature Studio | 1 |
| 3 | `cad_part_studio_contents` — see what is already in the tab | 1 |
| 4 | `cad_part_check` — DFM rules + hole compensation (3.40 → **3.62 mm**) | 0 |
| 5 | `cad_part_preview` — the one generated feature, its 6 editable parameters, its predicted box | 0 |
| 6 | `cad_part_push` — write the Feature Studio, insert **one** feature | 2 |
| 7 | `cad_part_verify` — bounding-box readback + one iso view | 2 |
| | **Total** | **7** |

All seven are session calls, so **0** are charged to the annual allowance. Drop the `verify: true` and
it is 6.

**Where that number comes from.** It is counted, not estimated:
`packages/cad/test/mcp-part-tools.test.ts` drives this exact brief through the real tools against a
scripted Onshape that records every request, and asserts `onshape.calls` has length 7. The **request
count is real**; the server it talks to is a fixture. The same file asserts that a 24-hole version of
the plate still costs **2** calls to push, which is the whole point of the one-feature design.

Then the cheap part:

> actually make it 8 mm thick

`cad_part_edit` with `[{ "parameterId": "baseThickness", "value": 8 }]` — **1 Onshape call**. It
updates the existing feature by id: nothing is regenerated, no Feature Studio is rewritten, no second
feature is inserted, so downstream references survive. The test asserts exactly that (one request, to
`…/features/featureid/{fid}`, and none to `/featurestudios/`).

If the edit would break a rule — 0.2 mm is thinner than one 0.42 mm bead — it is blocked **before**
the call, with the failing rule named. If it is structural (a new hole group, a different pattern
kind, a value outside the parameter's own bounds), it comes back `rebuild_required` with the editable
parameters and their ranges, also for free.

---

## 5. The pipeline tools

`cad_tools` prints the per-operation table at runtime; both tables are generated from
`packages/cad/src/cad-tool-catalog.ts`, so they cannot drift from what the agent can actually run.

| Tool | Calls | What it does |
|------|:-----:|--------------|
| `cad_auth_status` | 0-1 | Which Onshape credential this terminal will use and whether it is deducted from your Onshape annual API allowance. |
| `cad_open_document` | 1 | Bind (or resume) the Part Studio every later tool edits, from a pasted Onshape URL or explicit ids. |
| `cad_part_studio_contents` | 1 | List what is already in the bound Part Studio: every feature, which ones Vantage created, and any generated part feature `cad_part_edit` could change. |
| `cad_part_check` | 0 | Run every local design-for-manufacturing rule against the part and return the diameters to actually MODEL. |
| `cad_part_preview` | 0 | Generate the ONE FeatureScript feature and show what it would produce: predicted bounding box, hole centres, editable parameters, source, and the push cost. |
| `cad_part_push` | 2-4 | Write the generated FeatureScript into the Feature Studio and insert it into the Part Studio as ONE custom feature. |
| `cad_part_edit` | 0-1 | Change dimensions on the part feature that is already there, by feature id. No rebuild. 0 when the value is already correct. |
| `cad_part_verify` | 0-2 | One bounding-box readback and one iso shaded view, compared against the prediction. |

### What the part schema can build

A **plate**, a **box** (optionally hollow, optionally open-topped), or an **L bracket**, plus hole
groups (grid / four corners / linear run / bolt circle / explicit points, each optionally
counterbored), rectangular pockets, axis-aligned ribs, heat-set insert bosses, and fillets or chamfers
on the corner edges or all edges. The origin is the centre of the base footprint, +Z is up, and the
base sits on Z = 0. Anything outside that — swept profiles, lofts, organic shapes — is what the
per-operation tools are for.

### The two call counts that are upper bounds

- `cad_part_preview`'s `callPlan` always budgets a separate read for the Feature Studio microversion.
  `cad_part_push` skips it whenever Onshape's write response already carries one, and reports which
  happened in `microversionSource`. So the plan says 5 where the measured flow spends 4.
- `cad_part_push` can cost a 4th call creating a Feature Studio. **Onshape does not publish a
  create-Feature-Studio REST endpoint**, so this is opt-in (`allowCreateFeatureStudio: true`) and the
  result labels the endpoint unverified. The default is to tell you to add the tab yourself in Onshape
  (**+ → Create Feature Studio**) and re-run `cad_open_document`.

### Verified against Onshape's own documentation

| Used for | Endpoint | Source |
|----------|----------|--------|
| Insert the part feature | `POST /partstudios/d/{did}/w/{wid}/e/{eid}/features` | [Features](https://onshape-public.github.io/docs/api-adv/featureaccess/) |
| Edit it in place | `POST /partstudios/d/{did}/w/{wid}/e/{eid}/features/featureid/{fid}` | [Features](https://onshape-public.github.io/docs/api-adv/featureaccess/) |
| Bounding-box readback | `POST /partstudios/d/{did}/w/{wid}/e/{eid}/featurescript` | [Evaluating FeatureScript](https://onshape-public.github.io/docs/api-adv/fs/) |
| Annual allowance and what is counted | — | [API call limits](https://onshape-public.github.io/docs/auth/limits/) |

Vantage sends these at **`/api/v6/…`**; the Features page shows the same paths at v9. The version sits
directly after `/api/`, and v6 is what the FeatureScript page's own worked example uses.

**Not** documented publicly, and marked as such in the code: the Feature Studio contents endpoint and
its `sourceMicroversion` / `rejectMicroversionSkew` body (corroborated only by Onshape's own Python
client and forum posts), the `e{element}::m{microversion}` custom-feature namespace format (two
independent working API bodies in the Onshape forum), and the shaded-views response shape. The
FeatureScript language version is pinned to 2144 — the value Onshape's own API documentation uses in
its worked example — because Onshape never upgrades an existing part's version and old versions keep
working by design.

---

## 6. The per-operation tools

Use these when the part schema does not fit, or on Fusion. **Each one is a REST call**, so a five-step
build is five calls; on the API-key path that is five off the annual allowance.

Every Onshape tool works on the **bound Part Studio**. `onshape_bind` (or `cad_open_document`) stores
the document, workspace and element ids in `~/.vantage-cad/claude-session.json` — ids only, never
secrets. Binding also scopes **undo**: `onshape_delete_feature` will only delete a feature Vantage
created in the current binding, so it can never eat hand-built history.

| Tool | Onshape | Fusion | What it does |
|------|:-------:|:------:|--------------|
| `cad_status` | yes | yes | Onshape credentials, the local Fusion add-in, and the bound Part Studio. |
| `cad_setup` | yes | yes | Short setup steps for both platforms. |
| `cad_tools` | yes | yes | Every per-operation tool with its Onshape / Fusion support. |
| `onshape_list_documents` | yes | — | Recent documents for the connected account. |
| `onshape_list_elements` | yes | — | Elements (Part Studios) in a document workspace. |
| `onshape_bind` | yes | — | Remember the Part Studio this session edits. |
| `onshape_describe` | yes | yes | The feature tree, with plain-English explanations. |
| `onshape_sketch_rectangle` | yes | yes | Rectangle sketch on Front/Top/Right, in mm. |
| `onshape_sketch_circle` | yes | yes | One or more circles. <br>_Fusion draws one per sketch._ |
| `onshape_sketch_polyline` | yes | — | Open path or closed polygon from explicit mm points. |
| `onshape_sketch_points` | yes | — | Bare points — the drill locations `onshape_hole` consumes. |
| `onshape_extrude` | yes | yes | NEW / ADD / REMOVE / INTERSECT, depth in mm. |
| `onshape_fillet` | yes | yes | `selection='corners'` rounds only the plate corners. <br>_Fusion rounds every edge._ |
| `onshape_chamfer` | yes | yes | Equal-offset bevel. <br>_Fusion bevels every edge._ |
| `onshape_hole` | yes | — | A real Hole feature at the points of a point sketch. |
| `onshape_linear_pattern` | yes | — | Repeat features along X/Y/Z. |
| `onshape_circular_pattern` | yes | — | Repeat features around a cylindrical face. |
| `onshape_mirror` | yes | — | Mirror features across a standard plane. |
| `onshape_delete_feature` | yes | yes | Undo a feature *this session* created. |
| `fusion_status` | — | yes | Ping the local VantageCadRelay add-in on loopback. |
| `fusion_describe` | — | yes | Body / feature counts in the open design. |
| `fusion_sketch_rectangle` | — | yes | Rectangle sketch in the active design. |
| `fusion_sketch_circle` | — | yes | Circle sketch in the active design. |
| `fusion_extrude` | — | yes | Extrude the latest sketch. |
| `fusion_fillet` | — | yes | Round every edge of the most recent body. |
| `fusion_chamfer` | — | yes | Bevel every edge of the most recent body. |
| `fusion_undo_last` | — | yes | Delete the most recent feature the relay created. |

Selections are never guessed. Edges, faces and vertices are resolved by evaluating a read-only
FeatureScript query against the real model first (`packages/cad/src/onshape-resolve.ts`); if nothing
matches, the tool says so and changes nothing.

---

## 7. Fusion 360 (Windows / macOS)

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

The add-in implements **eight** operations: `create_sketch`, `create_extrude`, `create_fillet`,
`create_chamfer`, `delete_feature`, `verify_topology`, `render_views`, `create_checkpoint`. Holes,
patterns, mirror, polyline sketches **and the whole part pipeline** are Onshape only — the pipeline
generates FeatureScript, which is an Onshape language. The tool list says so up front rather than
letting the agent discover it halfway through a build.

The add-in publishes its own operation list on `GET /health`; `vantage-cad doctor` compares it against
what this build expects and tells you to run `vantage-cad update` if they differ.

Linux: Onshape only. Autodesk Fusion is not available on Linux — use `VANTAGE_CAD_MOCK=1` if you only
need to exercise the relay protocol.

---

## 8. CLI commands

```text
vantage-cad <login|setup|start|status|diagnose|doctor|update|logout|claude|mcp|agent|onshape|fusion>
```

| Command | What it does |
|---------|--------------|
| `vantage-cad login [--timeout <s>] [--status] [--clear]` | Sign into Onshape in a browser window and save the session. **Start here.** |
| `vantage-cad doctor` | Full preflight, `[PASS/WARN/FAIL]` per line. Exit code 1 on any FAIL. `--json` for machine output. |
| `vantage-cad status [--json]` | Platform, binding, Onshape auth path, call ledger, web sync state. |
| `vantage-cad mcp` | Speak MCP on stdio — what `.mcp.json` runs. |
| `vantage-cad claude` | Print setup instructions and current status. |
| `vantage-cad setup` | Pair this machine with your team's Vantage org so terminal CAD shows up on `/cad`. |
| `vantage-cad start` | Run the relay bridge (and the in-process mock plugin under `VANTAGE_CAD_MOCK=1`). |
| `vantage-cad update` | Reinstall the CLI and the Fusion add-in so both match the server. |
| `vantage-cad logout` | Forget this device's pairing. |
| `vantage-cad onshape docs\|elements\|bind\|describe\|sketch\|extrude` | Direct Onshape subcommands. |
| `vantage-cad fusion ping\|describe\|sketch\|extrude` | Direct Fusion subcommands. |

`vantage-cad status` and `vantage-cad login --status` both print the call ledger: how many calls this
machine has made on each auth path, and how many of them Onshape will have charged to the annual
allowance. Onshape pools the real allowance company-wide, so **Onshape's own usage page is the
authoritative number** — this ledger only knows what Vantage did from this machine.

---

## 9. Team sync

If you run `vantage-cad setup`, each CAD tool call is reported to your team's Vantage org and appears
in **Recent CAD activity** on `/cad`, alongside sessions run from the web agent. Sync is best-effort
and never blocks a CAD operation; unpaired or offline, everything still works locally and queued
events flush on the next successful call.

---

## 10. The web agent (`/cad`)

The hosted agent runs the **per-operation** Onshape tools — Fusion needs a loopback relay on your PC,
and the part pipeline needs the terminal's own session file, so neither runs on the server. Three
modes: Simple (one brief, one loop), Plan (a numbered build plan and its questions before touching
Onshape), and Multitask (a checklist worked through one Onshape session, sharing one step budget).

---

## Safety and what is not certified

- Use a disposable document the first time. Undo only covers features Vantage added.
- The session file (`~/.vantage-cad/onshape-session.json`) and the binding
  (`~/.vantage-cad/claude-session.json`) are `0600` files in your home directory. The binding holds ids
  only. Never paste API secrets into chat.
- The Fusion relay binds loopback only and verifies a signed envelope on every job. Fusion is never
  hosted on Vercel.
- Printer profiles are read off the manufacturer's published specification, with the URL beside each
  profile. Material **shrinkage** figures are typical starting values, not vendor specs — filament
  makers largely do not publish them — and every report that depends on one sets
  `usesUnverifiedProfile` and tells you to print a coupon.
- Not certified engineering software: no stress analysis, no manufacturing certification, no
  competition-legal ruling.
