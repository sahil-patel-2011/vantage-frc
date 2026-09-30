# FRC test-agent implementation plan

Planning date: 2026-09-29. Scope: Vantage web, Scouting, connected services, and separately declared desktop/device acceptance.

**Status: plan only.** No test agent has been implemented by this task. No application GUI, current test suite, production configuration, or competitor app was exercised during this planning review. Repository documents and test source were inspected; Lovat's public website and guides were read. Historical evidence below is not a fresh verification.

## 1. Objective and honest finish line

Build a repeatable test harness that discovers the product from code, performs real browser journeys, checks persisted outcomes, and reports whether the product is useful for actual FRC work. It must identify dead features, confusing navigation, lost data, inaccurate calculations, and deployment gaps without protecting the product's reputation.

“Test every feature” means **every discovered feature has an explicit acceptance contract and a reported disposition**. It cannot mean proof of every possible input, browser, device, concurrency schedule, or human experience. Publish the tested scope and remaining combinations.

Two independent verdicts are required:

1. **Functional acceptance:** Did the correct action happen, for the correct person/team/event, with persistence and appropriate failure behavior?
2. **FRC usability:** Could the intended user discover and complete the job at match speed, on the relevant device, without programming knowledge or undocumented help?

A page rendering, a successful HTTP response, a passing unit suite, or a polished screenshot proves neither verdict on its own. Additional features do not compensate for broken scouting.

## 2. What already exists and what is missing

Reuse the existing stack; do not introduce a second browser-testing framework:

- [Playwright configuration](../../playwright.config.ts), [attachment configuration](../../playwright.fixture.config.ts), Vitest, TypeScript, and installed `@axe-core/playwright`.
- [Real-session helpers](../../tests/browser/session.ts), [local database guard](../../tests/browser/origin.ts), existing role/isolation tests, and offline/scouting journeys.
- [Release inventory generator](../../scripts/release-inventory.mjs), [completion matrix](completion-matrix.md), feature manifests, [feature map](../FEATURE_MAP.md), and navigation definitions.
- [Browser shard runner](../../scripts/run-browser-shard.mjs): preserves failures/retries/skips and verifies planned versus reported cases. **Test-case accounting is not feature acceptance coverage.** Retain both measurements.
- [Built acceptance server](../../scripts/start-acceptance-server.mjs): validates scratch databases, starts a production-mode build, and keeps signup closed.
- [Existing specialist benchmarks](BENCHMARKS.md): useful starting protocol, not established superiority.

Concrete weaknesses found in the inspected test source:

- [Feature-map walking](../../tests/browser/feature-map-walk.spec.ts) deliberately uses proxy-only authentication, checks first paint, and skips its broad browser walk unless explicitly enabled. It is catalog/shell evidence, not authenticated feature acceptance.
- Some [student-week journeys](../../tests/browser/student-week-gui.spec.ts) accept working controls **or** setup/retry/load-failure states, and sometimes only check that clicking does not crash. Valid shell checks must not be promoted to completed workflows.
- [Session helpers](../../tests/browser/session.ts) can return false locally; callers may skip or fall back to a proxy fixture. New acceptance journeys must require a real session, not quietly downgrade.
- Session setup dismisses first-run tours. Keep this shortcut for regression tests, but use clean, undismissed profiles for onboarding/usability trials.
- [Control-name checks](../../tests/browser/every-control-has-a-name.spec.ts) treat placeholders as a pragmatic identifier and cover a selected page list. That is not full accessible-name conformance or full control/state coverage; strict accessibility audits must use actual semantics and retain manual/incomplete findings.
- The completion matrix still records substantial partial/pending workflow evidence. Do not infer readiness from historical test counts.
- Documents disagree on some claims and operating states: prediction error bands, signup behavior, sharing defaults, and scheduled-job configuration. [Release status](STATUS.md) records superseded decisions. Resolve acceptance expectations using current approved policy, code, and runtime evidence; do not let the agent choose the easiest historical claim.

These are evidence gaps, not a claim that all corresponding features are currently broken. Fresh execution determines the verdict.

## 3. Architecture: one harness, separate roles

```text
Source + routes + manifests + approved requirements + existing tests
                              |
                 Feature inventory and contracts
                              |
       Guarded environment + isolated fixtures + test identities
                              |
          Deterministic Playwright journeys and bounded explorer
                              |
      UI events + screenshots + traces + API/DB outcome checks
                              |
              Independent verifier and FRC reviewer
                              |
     Coverage ledger + defects + benchmarks + release disposition
```

### A. Code-aware planner

Read routes, components, API handlers, validation, permissions, database access, offline queues, feature switches, jobs, and existing tests. Map each feature to its dependencies and supported states. Flag apparent missing enforcement, stale-response races, swallowed errors, no-op actions, and fabricated metrics as hypotheses until reproduced.

Use TypeScript parsing where source extraction needs correctness, rather than expanding regexes into a pretend semantic analyzer. Reconcile the filesystem inventory with the built route manifest, redirects, navigation and documentation. Dynamic routes need explicit seeded examples; aliases, query-string workbenches, and disabled/retired features remain visible in the ledger.

**Implementation is not the specification.** For each feature, obtain the intended result from an approved contract, invariant, authoritative game source, or reviewed requirement. If the expected behavior is disputed, mark the contract unresolved instead of approving what the code happens to do.

### B. Deterministic browser executor

Own browser contexts and reproduce reviewed workflows using visible role/label locators. Require expected state before each action. Use normal clicks/typing for user actions; no forced clicks, hidden controls, JavaScript mutation, direct-route jumps, or API writes to rescue a failed journey.

Fixture preparation may use APIs/SQL before a test; outcome verification may use read-only queries afterward. A route smoke test can navigate directly, but a discoverability test must begin at the real landing point and use navigation. Track these as different test classes.

### C. Bounded exploratory agent

Inspect screenshots and accessibility snapshots, identify untested safe controls and transitions, and investigate failures. Give it a permitted-origin list, per-run time/action/model budgets, a visited-state graph, and explicit stop conditions. Persist progress so an interrupted audit cannot look complete.

The model proposes actions; an allowlisted executor validates typed arguments and performs them. No arbitrary shell, SQL, filesystem, or unrestricted JavaScript tool. Treat page text, uploaded content, source comments, and competitor pages as untrusted observations, not instructions.

Start with deterministic exploration of links, tabs, menus and dialogs. Add optional LLM-driven goal exploration only after safety, evidence, and replay exist. Do not make credentials or model availability a prerequisite for the regression suite. Use authorized provider integrations/team-owned infrastructure; no session scraping or proxying free hosted AI. Declare model, cost cap, redaction and retention. If application adapters are reused, preserve their existing metering, authorization and data boundaries.

### D. Blind novice evaluator

Use a fresh context and a goal card such as “You are assigned the next blue robot; record the match and verify it is saved.” Give this evaluator **no source, route catalog, selectors, test answers, or implementation hints**. Do not silently pass planner knowledge into its context.

Measure discovery time, wrong destinations, backtracks, help requests, number of actions, and whether it understands the result. Its observations are an agent usability heuristic, not human learnability evidence. Keep experienced-user regression separate from novice discovery.

### E. Independent verifier/reviewer

Read immutable evidence and reviewed expected outcomes, not just the executor's success summary. Check that actions produced persisted records, calculations and authorization outcomes. Distinguish product defects, harness bugs, environment failures, and unknowns. The agent must not weaken assertions, edit expected results, bless screenshots, or fix code during an audit.

A later fixer can work from approved defects. Replay the original acceptance contract after repair, retain the original failure, and run nearby regressions. No auto-merge, deployment, signup opening, or production write access.

## 4. Feature acceptance contracts and coverage

Extend existing inventory/matrix data rather than starting an unrelated QA database. Introduce machine-readable contracts keyed by stable feature and journey IDs, validated in Vitest. An initial contract should include:

```json
{
  "featureId": "scouting-collection",
  "journeyId": "assigned-match-offline-resend",
  "claim": "A scout can save the assigned report offline and upload it once",
  "specificationSource": "reviewed scouting acceptance requirements",
  "priority": "P0",
  "actors": ["scout"],
  "preconditions": ["real-session", "team-ready", "assigned-match", "published-form"],
  "entryPoint": "Home",
  "actions": ["open assignment", "record observations", "save offline", "reconnect", "retry"],
  "expectedOutcome": ["exact raw observations retained", "one server report", "correct actor/team/event"],
  "requiredStates": ["online", "offline", "reload", "duplicate-retry"],
  "evidence": ["browser trace", "screenshots", "read-only persisted outcome"]
}
```

Expand contracts with API dependencies, data oracle, permitted mutations, fixture ownership, cleanup, applicable devices/roles, deadline, and linked existing tests. Track controls by page state and semantic identity, not raw DOM node counts: Save in a create form and Save in an edit form are distinct transitions.

Report coverage separately for:

- **Inventory:** discovered features with a reviewed contract/disposition.
- **Routes/navigation:** resolved paths and reachable advertised destinations.
- **States/controls:** exercised meaningful transitions in applicable states.
- **Outcomes:** persistence, correctness, permissions, exports, failure recovery.
- **Usability:** blind agent trials and actual human/device trials, separately.
- **Deployment/integrations:** local real-data, controlled integration, provider sandbox, and deployed evidence, separately.

Use `passed`, `failed`, `blocked`, `not-run`, `flaky`, and `not-applicable`. A setup screen can pass a **missing-configuration** contract; it cannot pass the **configured functional** contract. Disabled media remains accounted for as intentionally unavailable, including gate and preservation checks—not working upload functionality.

Every blocked/skipped/not-applicable item needs a reason, owner, and scope. A retry-only success remains flaky until investigated. Keep denominators fixed to the reviewed applicable inventory; never remove inconvenient cases to improve the percentage. Report unknown/uncontracted features explicitly.

## 5. Safe environment and reproducible fixtures

Before any run:

1. Record source revision, dirty-tree fingerprint without content/secrets, build ID, runner/browser versions, fixture version, season/form versions and seed. Detect source changes during execution and mark the run mixed/invalid if needed.
2. Validate **all** database aliases, actual session identity, organization readiness, effective request role and RLS. Do not permit hosted/production databases for mutation tests. Use production-equivalent restricted roles, not a database owner.
3. Inspect existing listeners before choosing a port. Use an owned checkout/build output and server; do not attach destructive tests to another thread's server. Parameterize the existing hardcoded acceptance origin carefully and preserve its guards.
4. Seed two isolated teams with asymmetric permissions; owner/admin, scout/member, viewer, no-team and platform identities where supported. Include an account that owns Team A but only scouts for Team B.
5. Create empty/new-team, realistic event/season, contradictory reports, missing-data, malformed-input and stale-data fixtures. Use reviewed synthetic records with known answers, not invented demo metrics presented as live team data.
6. Route outbound email, purchases, OAuth, AI/CAD mutations and webhooks to approved sandboxes/fakes. Verify integration behavior separately against authorized provider sandboxes; fake-provider success is not live-provider evidence.
7. Give every mutation a run ID/ownership record. Cleanup only owned rows/resources, using `finally` teardown and a residual-record check. Never hide leaked fixtures behind “best effort” cleanup. No broad deletes or reset of shared data.

Test a production-mode build with real Better Auth sessions for acceptance; proxy fixtures are dev-only shell tools. Include genuine OTP/invitation/onboarding UI journeys separately from API-assisted session preparation. Validate the supported signup policy without changing production gates.

Never load production secrets to make local testing convenient. Redact tokens, cookies, student identities and provider credentials before publishing traces/logs/screenshots. Protect raw artifacts with limited retention/access. Competitor testing needs permission for accounts/data mutations and must respect terms and rate limits.

## 6. Test layers and GUI checklist

### Layer 1 — source and service checks

Run existing types, lint, unit and relevant database/RLS tests. Add contract validation, inventory drift and invariants: money arithmetic, duplicate-match aggregation, missing-versus-zero, immutable report identity, selected-team/event coherence, safe tenant queries and irreversible-action authorization.

Inspect every API method and background job's contract, including features without a page. A unit-tested job plus a configured secret does not prove scheduled execution; require trigger, completion and persisted-effect evidence at the declared environment.

### Layer 2 — systematic GUI/state checks

For each applicable role and state, cover:

- Buttons/links: discoverable name, correct destination/action, enabled/disabled reason, double-submit protection, confirmation and recovery.
- Fields: labels, required/invalid/boundary values, numeric units, focus errors, drafts, save/cancel, edit/delete and reload persistence.
- Menus/dialogs/tabs: pointer/touch/keyboard use, focus containment/return, Escape/back, active context, stacking and scrolling.
- Tables/charts: search, sort, filters, pagination, sample counts, consistent scales, missing data, corrections, download/export fidelity and print readability.
- Uploads/integrations: valid/invalid/oversized inputs, setup/connect/disconnect, revoked permission, progress, timeout/retry and preserved existing data.
- Loading/empty/error states: correct meaning and next action; no fake success or loss of previously painted data after a failed refresh.
- Layout/visuals: screenshots before/after key transitions, clipping, occluded controls, mobile keyboard, overflow, long labels, sticky elements and short screens. Screenshot differences flag review; they do not independently determine correctness.
- Accessibility: default axe scans of settled states plus manual keyboard, actual names, focus, zoom/reflow, contrast, screen-reader and OS-preference checks. Preserve incomplete findings and do not exclude failing regions.

Begin at 390px phone and 1280/1440px desktop, then 320px small phone and tablet. Cover light/dark, touch/keyboard and reduced motion. Default Chromium is only the first target; add WebKit/Firefox where supported. Browser emulation is not physical-device proof, especially for iOS offline storage, camera QR, haptics, PWA installation and Electron.

### Layer 3 — adversarial reliability

Introduce controlled timeout/401/403/429/5xx responses, network loss mid-save, reconnect, duplicate retry, concurrent edits, multiple tabs, reload, expired sessions, account/team changes, storage quota pressure and schema/version changes. Observe both displayed status and persisted effects.

Offline acceptance must include: prepare phone online → true no-network warm/cold reload → record/save → close/reopen browser/app → reconnect → verify exact server data once. Two contexts can test transfer logic; real distinct devices and camera scanning remain separate gates. Never declare hardware, venue Wi-Fi, battery life or crash/OS-kill behavior verified from a mock.

## 7. FRC workflows to prioritize

| Priority | Real task | Required proof |
|---|---|---|
| P0 | Invited rookie signs in and finds the assigned robot/match | Correct identity/event/robot; no hidden setup knowledge; first-use flow retained |
| P0 | Scout an entire recorded match; correct a mistake | Season-correct phase/timer/actions; original observations and correction history; missed-action/timing assessment |
| P0 | Save offline, restart, reconnect, resend and transfer by QR | Zero lost observations; one accepted report ID; explicit device/upload state; lossless provenance |
| P0 | Shared-device account change; Team A owner to Team B scout | No previous person's private data; queued work cannot change owner/team; restrictions persist |
| P0 | Lead assigns/replaces absent scouts and finds missing reports | Accurate coverage and ownership; full collection-to-lead handoff |
| P0 | Compare three robots and explain a displayed average | Same source/filters/units/counts across profile/chart/export; zero differs from unknown; duplicate reports do not inflate matches |
| P0 | Rank/lock/share a pick list during alliance selection | Exact saved weights/order/revision; concurrent/new data does not silently reorder a locked board |
| P0 | Drive team retrieves next-match briefing and pit readiness | Correct event, six robots, schedule/alliance/bumper context; readable saved briefing; no false-ready battery |
| P1 | Request part → approve → order → receive → consume in repair | Correct quantity, stock and ledger effects once; responsible person; unauthorized actions rejected |
| P1 | Record expense, grant award, received cash and reimbursement | Award is not automatically received money; commitments differ from spending; drill-down totals agree |
| P1 | Calendar/task/hours/chat/playbook/logistics handoffs | Correct person/team/date, persisted changes, source links and usable next actions |
| P1 | CAD/code connection and permitted job | Real connection/document/repository, actual output/progress/approval; paste link alone is not CAD automation |
| P1 | Export, deletion, consent, recovery and scheduled refresh | Authorized scope; lossless export/restore; policy enforcement; actual job completion |
| P2 | Learning, advanced analysis, sponsors/outreach and remaining tools | Reviewed contracts and real outcomes; unresolved requirements remain visible |

These are implementation order, not permission to omit lower-priority features. Include all inventory features in the final ledger.

For prediction accuracy, use chronological held-out scored matches with **as-of-match** input snapshots. Final-season ratings leaking future results invalidate the benchmark. Report sample count, missing-input coverage, MAE/RMSE, probability calibration/Brier score and simple baselines. Toy fixtures test code, not predictive quality. No ±3-point or superiority claim from a handful of synthetic matches.

## 8. Fair comparison with Lovat and other tools

Primary sources read on 2026-09-29:

- [Lovat overview](https://lovat.app/): contextual collection, team lookup, alliance planning, predictions, weighted/mutable shared pick lists and offline network/QR transfer are advertised.
- [Scouting a match](https://learn.lovat.app/guides/scouting-a-match): phase/context actions, drag rate/count shooting, duration defense, undo, conditional post-match questions, local save and QR fallback are documented.
- [Collection onboarding](https://learn.lovat.app/guides/collection-onboarding): team code, scout identity and assigned schedule are documented.
- [Team registration](https://learn.lovat.app/guides/registering-a-team) and [exports](https://learn.lovat.app/guides/exporting-data): registration/verification and role-limited, filtered CSV export are documented.

**These are documented capabilities, not measured reliability or ease of use.** The Lovat clients include native/mobile surfaces; a web browser agent cannot establish the complete native experience. Start with public-document/source comparisons; use authorized test accounts and physical/native-app sessions for direct measurements. If native automation is needed later, evaluate an additional device tool then; it is not an existing project dependency.

Use Lovat for scouting/strategy, QRScout or ScoutRadioz for offline collection/transfer, Statbotics for numerical presentation, and the team's Sheets/paper baseline. For broader operations use applicable specialists; do not score Lovat down for lacking finance/CAD features outside its purpose.

Benchmark identical goals and equivalent configured data, on the same devices/network and recorded match scenarios. Record each tool's version, configuration, permissions and provenance. Test default onboarding separately from tuned expert workflows. Do not penalize different valid security policies as defects, but measure their practical onboarding cost.

Recruit an initial pilot of 6–10 consenting representative users across rookie scouts, experienced leads, drive-team/pit users and mentors. Follow applicable school/team and guardian consent requirements. Counterbalance tool order and give equal training to reduce learning bias. This pilot is directional, not statistically generalizable superiority evidence; expand the study before broad claims.

Record:

- Unassisted completion and abandonment, with numerator/denominator.
- Time, interactions, wrong turns, help requests, correction/recovery effort.
- Eyes-off-field burden, missed/incorrect observations and duration error during recorded matches. Human annotations must distinguish exact known events from fuel estimates/uncertainty.
- Report loss, duplicates, local/server consistency and QR-transfer fidelity.
- Whether users can explain sources, units, sample counts and uncertainty.
- Confidence in “saved locally” versus “uploaded”; success retrieving the next task/briefing.

Publish raw trials and limitations, per task—not a made-up whole-app percentage. Use **better / comparable / worse / not measured**, with evidence and scope. For example: “Vantage required more steps to start an assigned match in this trial; Lovat was faster” is useful. “More features means better for FRC” is not.

## 9. Reports, severity and release rules

Each defect needs: stable ID, user task, severity, exact reproduction, role/team/event/season, expected versus observed result, source/build identity, screenshot/trace/log links, persisted-state proof where relevant, frequency, and confidence. Separate observed findings from hypotheses and historical known issues. Redact sensitive data.

Severity should reflect FRC consequences:

- **Critical:** cross-person/team disclosure, unauthorized financial/admin action, irreversible corruption.
- **High:** lost/duplicated scouting, wrong robot/event, broken core workflow, misleading saved state, unsafe false-ready status.
- **Medium:** repeated confusing navigation, wrong summaries with raw data intact, inaccessible controls, missing recoverable handoff.
- **Low:** cosmetic/detail defects without material task impact.

Produce a machine-readable ledger, human report and artifact index with build identity. Include planned/executed/passed/failed/blocked/not-run/flaky counts, missing contracts, applicable-state coverage, failed first attempts, cleanup leftovers, and model/runtime cost. Preserve original failures and append repaired reruns. Interrupted or missing results are incomplete, not passed.

Recommended release gates, to be approved before execution:

1. Every discovered feature is accounted for; every advertised supported feature has reviewed acceptance requirements. Intentional unavailability is disclosed.
2. All P0 journeys pass in the declared real-data phone/desktop/offline scope; no critical/high unresolved defect, missing P0 result, or retry-only P0 pass.
3. Configured behavior and missing-configuration behavior have separate verdicts. Required integrations still blocked means release incomplete, not “all passed.”
4. Raw observation integrity, tenant/privacy isolation, financial correctness and recovery requirements cannot be waived by a usability score.
5. No unresolved automated accessibility violation in audited required states; manual assistive-technology coverage is reported separately. No certification claim.
6. All required lower-priority acceptance dimensions are closed for a full-feature release. A narrower pilot requires explicit scope approval and disclosure, not silent exclusions.
7. Proposed novice pilot target: at least 90% unassisted completion for agreed core tasks, with actual counts and failure reasons. Small samples remain directional; this is not a universal usability score.
8. Deployed-build and real-device requirements are verified separately before public readiness claims. Local acceptance alone does not open signup.

## 10. Implementation phases and deliverables

Effort estimates are engineering days, not promises; they depend on contract quality, environment readiness and audit findings. Product repairs and recruiting/device access are additional work.

| Phase | Deliverables | Exit criterion | Estimate |
|---|---|---|---|
| 1. Inventory/contracts | Extend existing inventory and matrix; classify existing tests; establish all-feature ledger and P0 contracts; resolve policy conflicts | Inventory reconciled; no unidentified feature silently omitted; P0 expectations reviewed | 2–3 days |
| 2. Safe execution/evidence | Environment/session guards, owned fixtures, isolated built server, typed action policy, artifact/redaction pipeline and reporter | One real save/reload proof; unsafe target refused; failed precondition cannot downgrade to shell pass; cleanup verified | 2–4 days |
| 3. Competition vertical slice | Strict P0 journeys for assignment, collection/undo, offline/restart/QR, role/team switch, profiles and pick lists | Outcomes and failure states verified; original defects retained; phone/desktop traces replayable | 4–7 days |
| 4. Whole-product expansion | Contract-driven controls/state traversal; remaining Team/Build/Business/AI/admin/jobs; optional bounded model explorer; blind-agent sessions | All features have dispositions; unsupported/untested dimensions remain visible; generated cases are reviewed/replayable | 5–10+ days |
| 5. Real-device/human benchmark | Authorized Lovat/specialist trials, native-device evidence, novice study and comparison report | Same-task raw results, errors and limitations; no unsupported superiority claim | 3–5 days plus access/recruitment |
| 6. CI and ongoing audits | Deterministic PR gates, scheduled/manual full audits, changed-feature selection, historical trend reports | Deliberately introduced defects and missing-case reports are caught; stable bounded runs | 2–3 days |

Use the existing test directories and scripts; avoid adding a shipped “QA” app route. Add only focused contract, reporter and harness modules where reuse cannot address the need. Do not automatically generate hundreds of permissive tests.

Suggested implementation work breakdown:

- Extend inventory extraction and drift checks; add contract schema/validation and explicit test-to-contract mappings.
- Add strict real-session fixture/preflight helpers without changing legacy shell-test semantics.
- Add an evidence-aware Playwright reporter and safe-run wrapper around existing shard accounting; preserve build-mode separation.
- Add deterministic journey suites feature by feature, with read-only independent outcome oracles.
- Add state/control exploration and optional model goal runner behind explicit budgets and policy checks.
- Add a blind-goal task protocol and benchmark importer/report renderer. Keep human measurements separate.
- Extend existing CI deliberately: current browser-job conditions do not cover every main push. Add an explicit push/PR/manual policy for the new acceptance subset rather than assuming full coverage already exists. Avoid live competitor crawling on PRs.

Validate the harness itself using negative cases: refuse unsafe/production aliases and unknown origins; reject action types outside policy; fail missing real sessions; preserve intentional workflow failures; retain retries/skips; reject missing/duplicate coverage; detect fixture leakage; verify report redaction; detect source/build drift. A test agent that can label its own incomplete run green is itself defective.

### First milestone

Deliver a small, strict, reproducible **competition-day audit**, not a giant autonomous crawler: assigned robot → observed match → undo → offline save/restart → reconnect/duplicate resend → report/profile/export agreement → pick list → team/account isolation. Include a blind discovery session and a report that cannot hide blocked results.

Only after this vertical slice is trustworthy should the agent expand to the whole inventory. The desired outcome is not a green dashboard. It is a defensible answer to: **Would an FRC team trust this in the stands and pit, and where would a specialist tool still serve them better?**
