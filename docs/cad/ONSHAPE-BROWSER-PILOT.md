# Onshape browser CAD pilot — implementation and evidence

Status: development candidate, not a production release. Updated 2026-10-08.

## Product decision

Use a provider-neutral MCP connector with a visible Playwright-owned browser.
Vantage controls membership, device approval and the execution boundary. An AI
client supplies planning and visual interpretation. Do not embed Claude Code or
Codex terminal sessions as a shared team backend. Consumer subscriptions are not
server API credentials.

The native desktop workspace also has a source implementation of conversational
planning through Vantage's existing metered remote model adapter. It sends the
current viewport and an optional PNG drawing only after Start, then proposes one
registered UI operation at a time. This is separate from the external MCP client's
model connection; neither route launches a local model or terminal agent.

The new `ui-mcp` command is separate from legacy `mcp`, `login`, `onshape` and
hosted OAuth integrations. Those older paths use Onshape API calls, including
session `window.fetch`; they are not the browser-only implementation. Existing
legacy functionality is not silently redirected or deleted.

The UI engine exposes no HTTP, browser evaluation, cookie reads, arbitrary
selectors, uploads, sharing or API fallback. Onshape itself still performs the
normal network requests needed to run its website. This is not a claim that
browser automation bypasses Onshape terms, limits or service capacity.

## Implemented source

- `packages/vantage-cad-cli/src/onshape-ui/engine.ts`: serialized UI execution,
  exact document/workspace/tab binding, observation IDs, registered controls,
  unique observed tree names, disabled-state checks, screenshot bounds and
  optional UI postconditions. Canvas-coordinate clicks additionally require an
  identical CSS-scale viewport PNG immediately before acting; changed camera,
  geometry or other visible pixels invalidate the observation even when ARIA and
  canvas bounds match. This deliberately stops on animation or visual changes
  and requires re-observation. Ordinary exact-locator actions retain the UI-state
  checks without pixel equality. An uncertain action consumes its observation;
  callers must inspect before retrying.
- `atlas.ts`: observed locator registry, with manual verification status kept
  separate from supported action types. Tool command IDs are more stable than
  hardcoded screen coordinates, but still require current DOM verification.
- `runtime.ts`: newline-delimited MCP tools, bounded argument validation,
  per-operation Vantage authorization, cancellation and visible ephemeral browser
  ownership. No browser download or installation occurs automatically. The
  Onshape sign-in remains a human browser step.
- `intent.ts`: explicit dimensional units, drawing clarification and physical
  evidence requirements. Screenshot scale is not a source of exact dimensions.
  Extrusion and sketch dimension inputs require explicit supported units.
- `workflows.ts`: four guided MCP prompts for drawing-to-part, folder/document
  navigation, corrections and physical-property verification. A compatible AI
  client supplies the model; these prompts do not add a hosted model subscription
  or turn unavailable controls into supported operations.
- `apps/desktop/src/cad-controller.ts` and `scripts/cad/desktop-ui-worker.ts`:
  explicit start/stop, bundled-resource checks, a dedicated Playwright worker,
  current Vantage session authorization, and cleanup on departure from the CAD
  page, account changes or app exit. The web pilot page consumes this bridge.
  Missing packaged resources report setup required; they are never downloaded.
- `/api/cad/browser-agent/access`: current team eligibility through authenticated
  browser session or enrolled device credential. The authoritative organization
  is set by `VANTAGE_ONSHAPE_BROWSER_PILOT_ORG_ID`, not a client team-number claim.
- `/api/cad/browser-agent/enroll`: current member approves their own paired
  Onshape device using the current browser session and team authentication policy.
  Migration 0716 stores references to the approval session/MFA proof, not raw
  credentials. Leaving the team, revoked device, expired/deleted session or
  insufficient current authentication proof denies subsequent operations.
- `/api/cad/browser-agent/turn` and `browser-turn.ts`: current membership and
  authentication checks, metered remote image planning, bounded transient PNGs,
  structured single-action decisions, and no Onshape server transport. The native
  client displays action evidence, pauses for clarification and stops after twelve
  planning steps. Drawings and screenshots are not added to persisted chat history.

One engine owns one browser page. Concurrent calls serialize; two writes with the
same observation cannot both run. Parallel drawing interpretation, planning and
independent review are appropriate; competing geometry writers are not.

## Connector contract and intended setup

The primary AI entry point is a compatible local MCP client. Its configuration
uses an already installed pilot executable; it must never run an installer,
package download or legacy API command on connection:

```json
{
  "mcpServers": {
    "vantage-onshape-ui": {
      "command": "vantage-cad",
      "args": ["ui-mcp"]
    }
  }
}
```

This is a development configuration, not a downloadable or verified desktop
extension. MCPB manifest and platform resource staging sources are included for
compatible desktop clients. They use an already provisioned browser and never
install or download one on connection. No signed extension has been produced.

The connector initializes before pairing or browser launch. Its explicit setup
tools return a human approval link and short code, retain the polling secret only
in memory, and check once when asked after approval. Onshape is preselected on the
pairing page. The returned device platform is verified before credentials are
saved. Browser access then requires a separate current-session approval at
`/cad/browser-agent`; explicit Start opens the visible browser for human Onshape
sign-in. Native desktop launch instead uses its current Vantage session. These
are separate browser owners and must not run competing writers on one document.

Native conversation requires a configured, eligible remote image provider and
the existing team budget. An unsupported provider reports setup required instead
of falling back to local compute. The external MCP client supplies its own model.
The new native conversation, extension staging and guided setup have been reviewed
as source only; packaged execution and hosted acceptance remain release tasks.

## Hosted browser walkthrough

Inspected the user's signed-in Onshape site using browser Playwright locators,
read-only DOM inspection and visible canvas interactions. No Onshape API calls
were issued by the agent. Version observed: `1.221.89963.13d10d36cb23`.

Created a disposable document, **Vantage 6925 — Browser CAD verification**:

https://cad.onshape.com/documents/8ff4c341c89c57af88043967/w/d40da748ef1b988ba79c8e05/e/7c4f6b596cd7eb70a3ee6e3c

The walkthrough established these results in the real UI:

1. Created the document from Documents → Create → Document.
2. Created Sketch 1 on Top, drew a rectangle and committed it.
3. Extruded Faces of Sketch 1 by an explicitly entered `10 mm`; observed Part 1.
4. Opened mass properties: volume populated, but mass/inertia were blank with
   “One or more parts do not have a material defined.” No mass was inferred.
5. Assigned Aluminum - 6061 from the material library, then observed mass and all
   nine displayed inertia entries populate.
6. Switched to Assembly 1 and inserted Part 1 from the current document. The
   assembly reported one instance. Mates were not tested.
7. Reopened Sketch 1 and added explicit `40 mm` and `60 mm` dimensions, committed
   and observed regeneration to one part.
8. Observed final volume `1.465 in³`, consistent with a 60 × 40 × 10 mm block,
   and mass `0.144 lb` at the displayed precision. These are UI measurements,
   not an engineering certification. No alternate mate reference was selected.
9. Changed this disposable workspace's length unit to Millimeter and mass unit
   to Kilogram. Original user documents and account settings were not changed.
   The UI then reported volume **24000 mm³**, surface area **6800 mm²**, center
   **(30, -20, 5) mm**, mass **0.065 kg** (rounded), and diagonal inertia entries
   **9.248, 20.128, 28.288 kg mm²**, with zero displayed cross terms. These values
   are for the selected Part 1 using the dialog's default frame.
10. Created **Vantage browser pilot — disposable**, moved only the verification
    document into it, and observed the confirmed move and new folder breadcrumb.
11. Opened all nine current Part Studio dropdowns and recorded actual nested
    command identifiers in `onshape-menu-evidence-2026-10-07.json`. This records
    menu availability, not successful geometry creation with every tool.
12. Opened all thirteen sketch dropdowns, including constraints, and saved
    `onshape-sketch-menu-evidence-2026-10-07.json`. Left the sketch without edits.
13. Created a nested **Verification outputs** folder inside the disposable
    folder and returned through its parent breadcrumb. Folder links, ancestor
    menu and search controls are now registered. The document breadcrumb opens
    a separate browser tab; automatic popup adoption is not supported.
14. Created **Drawing 1** with the ISO_A3.dwt template. The drawing opened its
    Insert view panel in a separate embedded drawing interface. No part view was
    inserted and no drawing dimensions were verified. Returned to Part Studio 1
    and reconfirmed the block's mass/volume readout. Drawing iframe controls are
    not registered in this version of the executor.

Dimension placement initially rejected a selection. Recovery required leaving
the command, clearing selection, activating Dimension, selecting one edge,
observing that selection, then placing the dimension in a separate action.
Sending geometry clicks back-to-back before Onshape updates was unreliable.
The engine deliberately observes between actions instead of promising blind
high-speed clicks. This manual walkthrough is not a test of the newly authored
local runtime, which was not run under the laptop policy.

## Observed navigation and menus

| Surface | Observed path and controls | Verification limit |
| --- | --- | --- |
| Documents | Create → Document, Folder, Publication, Import files, Import from, Label; search, Type, Add, list/grid | Document/folder creation and same-owner test-document move verified |
| Document menu | Rename, Move to, Document details, Restore deleted workspaces, Copy/Update workspace, Workspace units/properties, view-only mode, Print, Close | Units and test-document move verified; ownership/share/delete actions not exercised |
| Tab insertion | Applications, Material Library, Feature Studio, Part Studio, Assembly, Variable Studio, Drawing, folder, Import | Menu observed, not every creation flow |
| Part Studio | Sketch, extrude/revolve/sweep/loft/thicken; fillet/chamfer/draft/rib/shell/hole/thread; pattern/mirror/boolean/split/transform; planes, frame, sheet metal | Toolbar identifiers observed; only sketch/extrude exercised |
| Sketch | Line, rectangle, circle, arc, polygon, spline, point, text, use, construction, fillet, trim, offset, mirror, pattern, dimension, constraints | Rectangle and two linear dimensions exercised |
| Extrude | Solid/Surface/Thin; New/Add/Remove/Intersect; Blind/Up to next/face/part/vertex/Through all; Depth, Direction, Starting offset, Symmetric, Draft, Second end | Solid/New/Blind/Depth exercised |
| Part context | Rename, Properties, Assign material, Edit appearance, Copy, Create drawing, Export, task, Hide, Isolate, Transparent, comment, zoom, Delete | Material assignment exercised |
| Analysis | Measure details, analysis tools, mass/section properties, reference mate connector, variance, overrides | Mass/inertia display exercised; overrides left off |
| Assembly | Insert, mate connector, Fastened/Revolute/Slider/Planar/Cylindrical/Pin slot/Ball/Parallel/Tangent/Width mates; Group, patterns, mirror, relations, display states, in-context Part Studio, Force | One insertion exercised; mating/simulation unverified |
| Drawing | Create Drawing → ISO_A3.dwt → Insert view; part selection, orientation, scale, simplification | Empty drawing creation observed; embedded controls and drawing operations unsupported by executor |

This is not an exhaustive account-, license- or selection-dependent button map.
Drawing editing, complex surface operations, imported geometry, export,
configurations and broader failure recovery still need coverage.

## Remote acceptance checklist

Run only in a named, authorized remote environment. Keep generated artifacts and
fixtures private. The test source files are not evidence that these checks pass.

1. Apply migration 0716 to the remote fixture database. Exercise current and new
   members of the configured 6925 organization, another organization also named
   6925, departed members, revoked devices, expired sessions and changed MFA policy.
2. Build/typecheck the CLI, web and desktop sources. Run the engine, protocol,
   intent, workflow, route/proxy and desktop controller tests, then the opt-in
   PostgreSQL acceptance source. Do not substitute mocks for membership acceptance.
3. Stage the already provisioned matching browser on each macOS/Windows target.
   Verify missing/wrong-architecture assets, launch failure, early stop, window
   close, app quit, network failure, sign-out and permission denial leave no worker
   or browser process behind. Verify the browser sign-in remains human-controlled.
4. Connect a compatible MCP client, retrieve a workflow, and perform the observed
   60 × 40 × 10 mm block recipe through this new executor. Reopen dimensions and
   read mass properties. This must be separate from the manual hosted walkthrough.
5. Exercise stale/ambiguous controls, manual UI changes, double submissions,
   changed document tabs, popups, missing materials and failed regeneration. No
   uncertain action may be reported as a completed model.
6. Benchmark agreed representative drawings end to end, including clarification,
   regeneration and independent review. Report median and tail completion times,
   retries and dimensional errors; reject the four-minute target if evidence does
   not support it. Broad UI mapping alone is not performance proof.

## Release gates still open

- Named authorized remote environment for typechecking, tests and database
  acceptance. No laptop tests/builds/servers/databases were run. Test sources were
  added, not executed; static review does not establish compilation success.
- Apply migration 0716 through the existing production schema gate only after
  remote acceptance. Bind the actual verified 6925 organization server-side.
- Exercise browser enrollment, departure, revocation, session expiry and MFA
  changes end to end against the candidate deployment.
- Package and verify the Playwright engine/browser in signed macOS and Windows
  desktop artifacts. Resources are staged per `onshape-ui/<platform>-<arch>/`;
  a universal macOS artifact must include independently accepted `darwin-arm64`
  and `darwin-x64` bundles. Runtime selection requires the matching directory and
  manifest; a missing bundle reports setup required without cross-architecture
  fallback. Staging one target preserves the other staged targets.
  The Electron shell is wired in source, but has not been
  built or executed; this is not a shipped desktop feature. No installer was
  run or computer configuration changed during development.
- Build and accept the native conversation and guided MCP setup on both platforms,
  including image limits, provider failures, usage accounting, cancellation and
  pairing recovery. Produce signed desktop and compatible MCP extension artifacts.
  Their source implementations are not proof of a working installed feature. Do
  not point new users at the old API-backed MCP.
- Run representative drawing-to-part benchmarks including dimensions, constraints,
  regeneration, corrections, materials and independent measurement. No sub-four-
  minute complex-drawing guarantee has been demonstrated.
- Verify the candidate UI and every supported recipe on both desktop platforms.
  Unknown controls must stop and request a fresh observation/map update.

No Actions runs, deployments, builds, local browser processes, installs or database
services were started for this work. Do not merge or publish this as production
ready until these gates pass.

Release inspection on 2026-10-07 confirmed repository Actions remain disabled
and Git-triggered Vercel deployments are disabled. The Vercel connector identified
the `vantage-frc-web` project, but returned no remaining allowance. Browser access
to Usage reached the account's authenticator/passkey challenge. No allowance was
inferred from plan labels and no deployment was started. Migration 0716 is now
included in the production schema preflight; it was not applied or bypassed.

Release inspection on 2026-10-08 found the latest production attempt failed at
the schema preflight because migrations 0710–0713 were absent. The stacked
candidate additionally depends on later migrations through 0716; redeployment
does not apply them. Existing Vercel billing data for the returned period
2026-09-30 07:00 UTC through 2026-10-08 07:00 UTC showed approximately $0.71 billed
and $8.38 effective usage across the account. These are historical account totals,
not this project's cost or proof of remaining free allowance. The connector was
authenticated while browser Usage still required login. No deployment or workflow
was started. The canonical `https://vantagefrc.vercel.app` homepage loaded in the
hosted browser; it does not contain the unmerged CAD candidate.
