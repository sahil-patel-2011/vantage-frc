# @vantage/cad

The CAD agent: Onshape and Fusion 360, driven from Vantage or from Claude Code.

## Modelling happens in Onshape, not in Vantage

There is no in-app model manipulation surface and that is deliberate. A
half-built viewport that can nudge a sketch is worse than no viewport: it is
slower than the real tool, it cannot do what the real tool does, and it teaches
a student a workflow that does not exist outside this app. Vantage drives
Onshape's own API and sends people to Onshape to model.

## Onshape, two ways in

**API keys** — `onshape-api-keys.ts`, signed requests, the normal path for a
team that has set them up.

**A signed-in browser session** — the agent drives a real Onshape tab. No OAuth
app, no key provisioning, and it works for a student who is already logged in.
Two things make this work:

- `onshape-session-store.ts` replays the session's own headers. Onshape uses
  double-submit CSRF, so a write needs the `XSRF-TOKEN` cookie echoed back as
  the `X-XSRF-TOKEN` header. Without it every write is a 401 and every read
  looks fine — which is exactly the shape of bug that wastes an afternoon.
- `sessionReplayHeaders` prefers a header actually observed on a real request
  over one derived from a cookie.

## Features are read from Onshape, not hard-coded

`onshape-generic-feature.ts` builds a feature from the `featurespecs` endpoint,
which describes all 97 feature types and their parameters. So the agent is not
limited to the dozen somebody remembered to write a wrapper for, and a new
Onshape release does not need a code change here.

`buildParameterFromSpec` converts by the spec's own type — `QUANTITY` by
`quantityType` (LENGTH mm→m, ANGLE deg→rad), plus `BOOLEAN`, `QUERY`, `ENUM` —
and **refuses** what it cannot build faithfully: arrays, lookup tables, and
references by name. A refusal is a message; a wrong unit is a broken part.

## Fusion 360

`fusion-relay.ts` talks to a local `VantageCadRelay` add-in, because Fusion has
no hosted API to drive. `mock-fusion-plugin.ts` lets the rest be tested without
Fusion installed.

## From Claude Code

`npx vantage-cad claude` wires these connectors into Claude Code. Setup:
[`docs/CLAUDE_CODE_CAD.md`](../../docs/CLAUDE_CODE_CAD.md).

## Layout

| Area | Files |
| --- | --- |
| Agent loop and policy | `agent-loop.ts`, `agent-modes.ts`, `agent-policy.ts`, `call-budget.ts` |
| Tooling surface | `cad-tool-catalog.ts`, `cad-agent-action.ts`, `cad-agent-steps.ts` |
| Onshape | `onshape-*.ts` |
| Fusion | `fusion-relay.ts`, `mock-fusion-plugin.ts` |
| Manufacturability | `dfm/` |
