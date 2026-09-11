# Product completion specification

Living operational ledger for Vantage (VantageFRC). This is not marketing, not a roadmap pitch, and not a feature-count. It is the accepted-plan source of truth for **what a real FRC team can finish a job with**, what is still an island or a shell, and what evidence a change must produce before a row may move to `verified`.

**Ledger date:** 2026-08-31.  
**Inventory freeze:** current `apps/web` nav + `app/` pages + `app/api/` + `apps/web/lib/manifests/` + workspace packages + `docs/FEATURE_MAP.md` + `docs/archive/FEATURE_COMPLETENESS_AUDIT.md` (2026-08-23) + `docs/GO_LIVE_CHECKLIST.md` (2026-08-24) + `docs/archive/COMMUNITY_DEMAND_RND.md` (stale recurrence claim corrected below).  
**Production posture:** no live external service and no production database is claimed working in this document. `docs/GO_LIVE_CHECKLIST.md` records that migrations were unapplied to any live production Postgres and that RLS had not been smoke-tested on a live host at that writing. Those claims stay open until a dated evidence link says otherwise.

Companion maps (do not treat as completion evidence):

- [docs/FEATURE_MAP.md](../FEATURE_MAP.md) — where UI lives
- [docs/archive/FEATURE_COMPLETENESS_AUDIT.md](FEATURE_COMPLETENESS_AUDIT.md) — 2026-08-23 depth audit (several rows below are **explicitly superseded**)
- [docs/GO_LIVE_CHECKLIST.md](../GO_LIVE_CHECKLIST.md) — code-traced journeys, not browser/event-day proof
- [docs/archive/VANTAGE_FRC_OPS_SPEC.md](VANTAGE_FRC_OPS_SPEC.md) — pit-reliability cues on existing pages
- [docs/DESKTOP.md](../DESKTOP.md), [docs/CLAUDE_CODE_CAD.md](../CLAUDE_CODE_CAD.md), [docs/AI_BRIDGE.md](../AI_BRIDGE.md), [docs/STORAGE_NODE.md](../STORAGE_NODE.md)

---

## 1. Definition of Done

A surface is **done** only when a named FRC job can be completed by a real team without leaving the product for a spreadsheet, paper, Discord, or a second Vantage page that re-enters the same facts — **and** the evidence pack below exists.

Page existence, a hub tab, a Soft-UI empty state, a manifest, or an API 200 on `setup_required` is **not** Done.

### 1.1 Product DoD (every row that wants `verified`)

1. **Job.** One FRC outcome sentence a mentor or scout would recognize (not “the page loads”).
2. **Canonical workbench.** One hub + tab is the place the job is finished. Satellites may feed it; they may not be a second system of record for the same object.
3. **Tenancy.** All reads/writes go through `withRls({ userId, orgId? })`. No `@vantage/db/admin` in request code. Cross-org read returns empty/404, never another team’s row.
4. **Honest empty / setup.** Missing TBA, GitHub, Onshape, Stripe, KMS, or org data shows setup/empty — never DEMO metrics, invented EPA, fake lodging, or zero-as-progress.
5. **Upstream.** Named producers (TBA cache, scout outbox, hour logs, CAD vault bytes, finance rows) actually write the fields this surface reads.
6. **Downstream.** At least one other compute module consumes the write (strategy reads scout payloads; pick desk reads the same pick list; briefing reads the card the strategist wrote). Islands cannot be `verified`.
7. **Acceptance scenario.** A single concrete path (actor, event, data in, data out, next page) that a reviewer can run.
8. **Evidence pack.** See §1.2. All four bullets required.

### 1.2 Evidence pack (required to flip `verified`)

| Required | What counts | What does not count |
|---|---|---|
| **Unit / contract** | Named test file that asserts the job’s compute or API contract (keys, chunking, RLS-shaped SQL params, no DEMO) | Snapshot of JSX; “tests exist in the folder” |
| **Route exercise** | Browser or Playwright path on the canonical URL **or** a dated curl transcript against a real session | Screenshot of first paint; `page.tsx` exists |
| **Integration hop** | Proof the upstream write is visible downstream (e.g. queued scout entry → `match_scout_entries` → strategy/pEPA field) | “They share a hub” |
| **Date + actor** | ISO date and PR/commit or run URL in the changelog (§10) | “We think this still works” |

**Never invent passing results.** If the test was not run in the PR, write `not run`. If production was not touched, write `no prod evidence`. Credential-free `npm test` does not prove TBA, Onshape, Stripe, Resend, or live Postgres RLS.

### 1.3 Cross-cutting DoD (platform)

These apply to every org-scoped feature. Failure keeps the row at `partial` or worse even if the UI is polished.

- Closed membership: exact-email invite; waitlist for everyone else ([`apps/web/proxy.ts`](../../apps/web/proxy.ts)).
- Incomplete profile → `/onboarding`.
- Metered AI through `meteredAI` / billing ledger; no denormalized credit counter.
- Parameterized SQL only (`$1::uuid`, `= ANY($n::text[])`).
- New org tables: `org_id` FK CASCADE, RLS, `is_org_member` / `has_org_role`, `GRANT` to `vantage_app` and `vantage_worker`.
- Exports never include API keys or other orgs’ AI memory.

---

## 2. Status semantics

Use exactly these tokens. Do not invent `shipped`, `solid`, `thin`, or `done`.

| Status | Meaning | May become `verified` when |
|---|---|---|
| **verified** | DoD + evidence pack complete for the named acceptance scenario. No known blocker on the happy path. | — |
| **partial** | Real compute and a real table exist; empty/setup is honest; at least one hop is missing (no downstream, GET-only, no export, no event-day refresh, or tests-only). | Missing hop + evidence pack |
| **broken** | Current code still fails the job (404 loop, wrong number, wrong target, data loss path). | Fix landed **and** evidence pack |
| **setup-only** | Usable only after env/OAuth/KMS/device pairing. Degrades honestly today. | Live configured org + evidence pack |
| **merge** | Same job as another row. Keep one system of record; redirect or nest the rest. | Canonical row is `verified`; this row is gone or is a tab |
| **hide** | Reachable but should leave Cmd+K / More until the job is real. Do not market. | Re-home or delete |
| **remove** | No unique job, or the route is a trap. Delete or permanent redirect. | Redirect live; inbound links updated |
| **unverified** | Code or a page exists; **this ledger has not seen evidence**. Default for almost every row on 2026-08-31. | Evidence pack |

Rules:

- Initial fill is **conservative**. Prefer `unverified` or `partial` over `verified`.
- `docs/GO_LIVE_CHECKLIST.md` “PASS” is **code-trace**, not `verified`.
- Unit tests (chunking, recurrence, Bugbot retarget, vault format detect) support `partial`, not `verified`.
- A Soft-UI banner that says “never DEMO” is a contract, not proof the live path works.

---

## 3. How this ledger is inventoried

| Source | Role |
|---|---|
| [`apps/web/lib/nav/hubs.ts`](../../apps/web/lib/nav/hubs.ts) | Canonical hub tabs and workbenches (199 tab ids across 6 hubs) |
| [`apps/web/lib/nav/product-nav.ts`](../../apps/web/lib/nav/product-nav.ts) | Drawer pillars (incl. Logistics), island, settings/logistics deep links |
| [`apps/web/lib/nav/command-search.ts`](../../apps/web/lib/nav/command-search.ts) | Cmd+K catalog + standalone destinations + actions |
| [`apps/web/lib/nav/legacy-redirects.ts`](../../apps/web/lib/nav/legacy-redirects.ts) | Legacy path → hub tab (`/match-copilot` → `/briefing`) |
| [`apps/web/app/**/page.tsx`](../../apps/web/app) | 294 page modules (hub leaves + standalone + admin + public) |
| [`apps/web/app/api/**/route.ts`](../../apps/web/app/api) | 412 API route modules |
| [`apps/web/lib/manifests/`](../../apps/web/lib/manifests) | 124 feature manifests (intent/metadata; not runtime wiring) |
| Workspace `packages/*` | Domain libraries (see §8) |
| [docs/FEATURE_MAP.md](../FEATURE_MAP.md) | Soft-UI contracts and “never DEMO” rules |

Duplicate tab ids (`batteries`, `fmea`, `code`, `bugbot`, `impact`, `finance`) appear in more than one hub. The **route** is the identity; the second hub listing is a deep link, not a second product.

---

## 4. Core FRC jobs-to-be-done by hub

| Hub | Route | Jobs a team is actually trying to finish |
|---|---|---|
| **Home** | `/dashboard` | “What do I do in the next hour?” Personal widgets only from real rows. |
| **Competition** | `/competition` | Survive event day: who we play, who we scout, who we pick, robot ready for queue. |
| **Team** | `/team` | Season operations: who is coming, hours, work, playbook that survives graduation. |
| **Logistics** | `/logistics` | Get people and gear to the event (travel, packing, duties, visits). |
| **Business** | `/business` | One answer for money in/out; sponsors and grants that produce a submission; outreach evidence judges will accept. |
| **Build** | `/build` | Kickoff → CAD/code → a legal, weighed, wired robot with parts and prints that match the BOM. |
| **AI** | `/ai` | Ask / write / run tools under a budget the mentor can kill; notes that persist. |
| **Media** | `/media` | Post on time with real assets; kit a sponsor or reporter can use. |

Island defaults ([`PRIMARY_TABS`](../../apps/web/lib/nav/product-nav.ts)): Home · Compete · Team · Business. Everything else is hub tabs + ⌘K.

---

## 5. Feature ledger — conventions

Each row:

- **FRC outcome** — the job.
- **Status** — §2 token. 2026-08-31 fill is conservative.
- **Workbench** — hub `?tab=` that owns the job.
- **Up → down** — producer → this surface → consumer.
- **Acceptance** — one scenario. Not a test claim.
- **Evidence / blocker** — file link or open defect. `no prod evidence` is the default blocker.

Grouped satellites still list **every named route**.

---

## 6. Competition (`/competition`)

Nav: [`apps/web/lib/nav/hubs.ts`](../../apps/web/lib/nav/hubs.ts) (Event day · Scouting · Strategy · Pit).  
Map: [docs/FEATURE_MAP.md](../FEATURE_MAP.md).

### 6.1 Event day workbench

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Event day** `command` · `/competition?tab=command` · `/command` | Field-side now/next: matches, pit flags, travel clarity, links out. | partial | Event day | TBA `matches_ref` → command → My Day / Briefing / Logistics | With a bound event, next match and bumper color come from cache; no event → empty, not DEMO. | Code-trace [GO_LIVE §5](../GO_LIVE_CHECKLIST.md) is briefing, not this page. No event-day poll proof. `unverified` live. |
| **My Day** `my-day` · `/my-day` | “What do I do until the next match?” | partial | Event day | assignments + TBA times → member | Member sees own next match or empty. | Audit: no poll vs `/command`. Still `partial`. |
| **Day plan** `event-day-plan` · `/event-day-plan` | Run-of-show for the date. | unverified | Event day | calendar / logistics → plan → My Day | Coach publishes a timed plan; drive team sees it on My Day. | Manifest exists. No hop proof. |
| **Drive-team board** `drive-team-signals` · `/drive-team-signals` | One board of signals for driver/operator/coach. | unverified | Event day | briefing / cards → board | Board shows only written signals. | Island risk vs briefing. |
| **Pre-match briefing** `briefing` · `/briefing` | **The** pre-match surface (Match Copilot absorbed). | partial | Event day | TBA + practice + video + assignments → brief → queue | Open `?matchKey=`; sections from `computeBriefingView`; `/match-copilot` redirects here. | Redirect: [`legacy-redirects.ts`](../../apps/web/lib/nav/legacy-redirects.ts). Compute: [`apps/web/lib/briefing/`](../../apps/web/lib/briefing). Audit “three briefings” is **partly stale** (copilot merged); `/command` still a second brief. Cards / counter-book / defense / watchlist consumption **unverified**. |
| **Schedule** `schedule` · `/schedule` | When we play, from TBA cache. | partial | Event day | `matches_ref` → schedule | Times + alliance color; no invented slots. | Read-only duplicate of command data. No poll. |
| **Rankings** `rankings` · `/rankings` | Current event rank from cache. | partial | Event day | TBA rankings → page → rank projection | Rank blank until cache row. | Same island/poll note as schedule. |
| **Event readiness** `event-readiness` · `/event-readiness` | Pre-event: inspection prep, consent, packing, travel in one dated flow. | partial | Event day | consent + packing + logistics + inspection | One event date shows remaining blockers, not four half-answers. | Community demand still calls this weak; pages still exist separately (`/consent`, `/packing`, `/logistics`, `/inspection`). |

**Match Copilot** `/match-copilot` — **merge**. Permanent redirect to `/briefing`. Do not rebuild. Inbound `orgId` / `matchKey` must survive.

### 6.2 Scouting workbench

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Scouting** `scouting` · `/competition?tab=scouting` · `/scouting` | Capture match/pit entries offline and sync. | partial | Scouting | tablet outbox → `/api/scouting/sync` → `match_scout_entries` / `pit_scout_entries` → strategy | Queue 120 entries offline; come online; outbox drains in ≤50-entry batches; one bad row does not kill the batch. | **Chunking fixed for new clients** — [`apps/web/lib/scout-offline.ts`](../../apps/web/lib/scout-offline.ts) `SYNC_BATCH_SIZE=50`, `sliceIntoBatches`, `resultsMode: "per-entry"`; tests [`scout-offline.test.ts`](../../apps/web/lib/scout-offline.test.ts). Server: [`apps/web/app/api/scouting/sync/route.ts`](../../apps/web/app/api/scouting/sync/route.ts). **Old JS clients** can still POST >100 and 400. No regional soak. Media last-mile still `partial`. |
| **Forms** `forms` · `/scouting/forms` | Coach publishes an FRC form (counters, timer, rating, pit photos). | partial | Scouting | drafts → `scout_schemas` → entry UI + strategy roles | Publish match form with counter + `config.role`; scout can tally; strategy sees the role. | Field types now include counter / multi_counter / timer / rating / multi_select / slider / field_position — [`form-builder.ts`](../../apps/web/lib/scouting/form-builder.ts). Audit “eight types, no counter” is **stale**. Rename-safety + season clone + mapping UI still `unverified`. |
| **Coverage** `scout-coverage-live` · `/scout-coverage-live` · `/scouting/lineup` | Who is unscouted this cycle and who is assigned next. | partial | Scouting | TBA alliances + assignments + entries → gaps → shifts / strategy | Unscouted stations listed from cache + entries; owner/admin can assign or swap scouts; never invented zeros. | Both UI projections now share [`lib/scouting/coverage.ts`](../../apps/web/lib/scouting/coverage.ts); Scout Coverage Live adds threshold/nudge projection without rereading a second schedule model. Contract tests: [`coverage.test.ts`](../../apps/web/lib/scouting/coverage.test.ts), [`compute-scout-coverage-live.test.ts`](../../apps/web/lib/scout-coverage-live/compute-scout-coverage-live.test.ts). Live-event proof remains open. |
| **Shifts** `shift-balancer` · `/shift-balancer` | Fatigue-capped scout rotations. | partial | Scouting | TBA quals + roster → sheets | CSV/tablet sheets; lunch gaps flagged; no invented match list. | FEATURE_MAP contract. Live event `unverified`. |
| **Pit mesh** `scout-p2p-relay` · `/scout-p2p-relay` | Sync tablets without event Wi‑Fi. | partial | Scouting | IndexedDB ↔ BroadcastChannel / QR → captain uplink | Two tabs same origin merge LWW; other devices use QR. | BroadcastChannel is same-profile, not true mesh. QR still size-capped (`packages/scouting` qr-handoff). |
| **Training** `scout-training-mode` · `/scout-training-mode` | Practice scouting without poisoning live data. | unverified | Scouting | published schema → sandbox | Training writes do not appear on pick desk. | Need isolation proof. |
| **Voice notes** (scouting `#scout-voice`) | Fast in-stand notes. | setup-only | Scouting | mic → cloud STT (metered) → form | Offline: audio queued, copy says transcribes when online. | Cloud STT; UsageCutoffBanner. |

#### Scouting quality satellites (all listed)

Canonical consumer should be **Forms + Coverage + Strategy**. These are meta unless they change a publish or an assignment. Eight of these (`scout-accuracy` through `scouting-schema-ab`) are `inStrip: false` — still in Cmd+K and on their routes.

| Tab | Route | Outcome | Status | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| Accuracy | `/scout-accuracy` · `scout-accuracy` | Who is right vs TBA | partial | entries × `matches_ref` → leaderboard | Accuracy blank until official scores exist | Own compute; does not write forms |
| Cross-check | `/scout-crossval` · `scout-crossval` | Double-scout agreement | partial | entries × entries | Disagreement list from real pairs | `auto_points` aliases in module |
| Disagreements | `/scout-disagreements` · `scout-disagreements` | Resolve conflicts | partial | disagreements table → trust | Coach marks which scout stood | Audit: numeric thresholds vs builder |
| Data impact | `/scout-data-impact` · `scout-data-impact` | Which fields moved picks | unverified | entries → pick use | Scout sees “your row informed this pick” | Job named; hop `unverified` |
| Field budget (strip label **Field value**) | `/scout-field-budget` · `scout-field-budget` | Form not too long | partial | schema field count | Warn past ~20–25 fields | Lint exists in form-builder imports. On the Scouting strip as Field value. |
| Assisted count | `/scout-assisted-count` · `scout-assisted-count` | Human box + machine count | unverified | video/region → tally | No full auto-ID claim | Research-shaped; hide until demo’d |
| Schema sync | `/scout-schema-negotiate` · `scout-schema-negotiate` | Tablets on same version | partial | schema versions | Stale tablet prompted | Producer of negotiate rows `unverified` |
| Heat signals | `/scouting-heat-signals` · `scouting-heat-signals` | Hot teams from entries | unverified | entries → heat | Null when n=0 | Island |
| Schema A/B | `/scouting-schema-ab` · `scouting-schema-ab` | Compare two forms | unverified | two schemas | No silent orphan of old keys | Island |
| Data quality | `/data-quality-scorecard` · `data-quality-scorecard` | Event data hygiene | unverified | entries + trust | Score from logged defects only | Island |

**Lineup** `/scouting/lineup` — **partial**. The former 404 loop is closed: [`/api/scouting/coverage`](../../apps/web/app/api/scouting/coverage/route.ts) serves the polled board and owner/admin assignment writes from real schedule, assignment, entry, and membership rows. `/scout-coverage-live` now adapts that same canonical compute. It is not `verified`: there is no live-event evidence pack.

**Semantic mapping (audit correction):** `packages/prediction-strategy/src/scout-ops.ts` now `normalizeSignalKey`, `inferRoleForFieldKey` (default `auto_score` / `teleop_score` / endgame / defense / fouls / notes), and `resolveSignal` ladder (schema role → legacy camelCase → case/separator-insensitive). Default `auto_score` is no longer invisible. **Not** `verified`: custom labels that infer `none` still need an explicit `config.role`; no event-weekend proof. Audit “bridge returns all-null on the default form” is **stale for key matching**; pick-list **unification** is still open (§9).

### 6.3 Strategy workbench

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Strategy** `strategy` · `/strategy` | Matchup plan + private edge (pEPA, scout diffs, pit pings). | partial | Strategy | scout entries + `team_event_metrics` + pit → desk | pEPA null until blendable fields; never DEMO win %. | [`compute-strategy.ts`](../../apps/web/lib/strategy/compute-strategy.ts); `GET /api/org/analytics/private-epa`. Mapping improved; weekend proof absent. |
| **Alliance desk** `alliance-selection-desk` · `/alliance-selection-desk` | Live 8-alliance board with scout evidence. | partial | Strategy | pick list + TBA metrics + evidence ids → export | Slots persist; evidence ids are this org’s. | Code-trace [GO_LIVE §4](../GO_LIVE_CHECKLIST.md). Still seeds independently of collab list (`partial`). |
| **Pick clock** `pick-clock` · `/pick-clock` | 45s next-best with reasons. | partial | Strategy | pick desk + board exclusions → recommendation | Clock reads `pick_lists` + `alliance_boards`; **cannot record a pick** (GET-only [`/api/strategy/pick-clock`](../../apps/web/app/api/strategy/pick-clock/route.ts)). | Recording is still a leave-the-page job. |
| **Chemistry** `chemistry` · `/chemistry` | Partner fit. | partial | Strategy | profiles → fit | GET analysis; save/promote `unverified`. | Island |
| **Pairwise** `pairwise` · `/pairwise` | A-beats-B ranking (Bradley-Terry). | partial | Strategy | taps → order | Empty until real taps; no DEMO ranks. | Does not write `pick_lists`. |
| **Drive-team tags** `team-tags` · `/team-tags` | Qualitative tags on event robots. | partial | Strategy | tags → pick reasons | Empty board until applied. | Tags do not reach pick-clock reasons. |
| **Pick list** `picklist-collab` · `/picklist-collab` | Weighted consensus list + CSV. | partial | Strategy | votes + EPA roles → CSV | CSV out; promote-to-canonical `unverified`. | Private tables vs `pick_lists`. |
| **Justifier** `picklist-justifier` · `/picklist-justifier` | Why this pick. | partial | Strategy | justifications → clock | Reasons appear on clock. | Own table; hop `unverified`. |

#### Strategy satellites (all listed)

| Tab | Route | Outcome | Status | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| Alliance sim | `/alliance-sim` · `alliance-sim` | What-if alliance | partial | typed robots → sim | No TBA auto-fill required | Manual entry island |
| Partner brief | `/alliance-partner-brief` · `alliance-partner-brief` | Hand to a partner | unverified | desk + cards → sheet | Printable brief from stored plan | |
| Counter-book | `/counter-book` · `counter-book` | How we beat them | partial | reports → briefing | Plan visible on briefing | Audit: stops in own table |
| Defense | `/defense-planner` · `/defense-planner` | Cycle/defense plan | partial | profiles + matchups | Empty until logged; metered writes | Does not read scout mass/cycles |
| Watchlist | `/opponent-watchlist` · `/opponent-watchlist` | Threats to cover | partial | entries → scout queue | Watchlist changes coverage order | Hop `unverified` |
| Match cards | `/match-strategy-cards` · `/match-strategy-cards` | Per-match game plan | partial | TBA match → card → briefing/DS | Card for our next match; auto/backup/deploy cues from text | FEATURE_MAP cues; briefing consume `unverified` |
| Match sim | `/match-sim` · `/match-sim` | Predicted score | partial | run → nowhere | Run stored; not a prediction widget | Island |
| Match notes | `/match-notes-timeline` · `/match-notes-timeline` | Clock-stamped notes | partial | notes → timeline | Empty until notes | |
| Match delta | `/match-delta-watcher` · `/match-delta-watcher` | What changed overnight | unverified | metrics Δ | Alerts from real EPA/score deltas | |
| Match video | `/match-video-index` · `/match-video-index` | Find the clip | unverified | video rows | Index empty until URLs | |
| EPA alerts | `/epa-trend-alerts` · `/epa-trend-alerts` | Rating moved | partial | Statbotics cache | No invented trend | Cron freshness `unverified` |
| Overnight intel | `/overnight-intel` · `/overnight-intel` | Prep for tomorrow | unverified | intel + scouting | No DEMO dossiers | |
| Districts | `/district-advancement` · `/district-advancement` | Points / qualify | partial | EPA + district cache | Odds blank without cache | Never DEMO qualification |
| Rank projection | `/ranking-projection` · `/ranking-projection` | Where we finish | partial | rank + remaining quals | No invented future rank | |
| Intel | `/intel` · `/intel` | Recon notebook | partial | `packages/intel-research` | Empty until logged | |
| Team dossier | `/dossier` · `/dossier` | Opponent one-pager | partial | TBA + scout + media | Thumbs only if `entry_id` linked | Media link historically broken |
| Video review | `/video` · `/video` | Film + notes | partial | YouTube / notes | Notes persist per match | Re-scout-from-video hop open |

**Pick-list model (still P0):** `pick_lists` / `picklist_collab_*` / `alliance_selection_desk_*` / pairwise / tags / justifier / chemistry remain separate stores. One captain job, several boards. Status stays `partial` until one list is system of record.

### 6.4 Pit workbench

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Pit** `match-checklist` · `/match-checklist` | Timed pre-queue checklist + correct bumpers. | partial | Pit | TBA alliance lists → checklist | Bumper color from lists; SB50 / DS / lens / bolt / Kraken / tape cues; old runs stay complete. | [FEATURE_MAP](../FEATURE_MAP.md); [VANTAGE_FRC_OPS_SPEC](VANTAGE_FRC_OPS_SPEC.md). Event-day `unverified`. |
| **Pit command** `pit` · `/pit` | Turnaround board. | partial | Pit | repairs + batteries + queue | Empty until flags | No poll vs command. |
| **Repair triage** `pit-repair-triage` · `/pit-repair-triage` | Fix vs swap before queue. | partial | Pit | FMEA + spares + time-to-match | I104 reinspect cue on open fix/swap; resolve does not invent “skipped inspection”. | Consume-on-swap hop still open (parts ledger). |
| **Charge plan** `battery-rotation` · `/battery-rotation` | Which pack is ready. | partial | Pit | charge logs → cart slots | Cool-down → Beak → Ready from logs only. | Same packs as `/batteries`. |

---

## 7. Team (`/team`)

### 7.1 Calendar workbench

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Calendar** `calendar` · `/team?tab=calendar` · `/team/calendar` | Shop nights, RSVP, TBA matches, GitHub dues on one grid. | partial | Calendar | events + rrule + TBA + RSVP → parent digest / hours | Create weekly shop night (`FREQ=WEEKLY`); occurrences expand; exception does not delete the series; ICS subscribe is token-only. | **Recurrence exists** — [`apps/web/lib/calendar/recurrence.ts`](../../apps/web/lib/calendar/recurrence.ts), [`series.ts`](../../apps/web/lib/calendar/series.ts), [`ics-recurrence.ts`](../../apps/web/lib/calendar/ics-recurrence.ts) + tests; API [`apps/web/app/api/team/calendar/route.ts`](../../apps/web/app/api/team/calendar/route.ts); migration `0456_calendar_recurrence` / parent-view rrule in `0471`. Audit + [COMMUNITY_DEMAND_RND](COMMUNITY_DEMAND_RND.md) “no rrule” is **stale**. Live series + parent digest `unverified`. Degrades if migration unapplied. |

### 7.2 Chat workbench

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Chat** `messages` · `/team?tab=messages` · `/messages` | YPP-safe team record: channels, supervised DMs, exportable transcript. | partial | Chat | members → messages → Slack/Discord bridge + inbox | New message appears at **bottom**; scrollback loads older; adult–student DM adds second adult or refuses; export is admin-only. | Multi-channel create/rename/archive, unread ordering, newest-first cursor history, supervised DMs, and audited export are implemented in [`messages/route.ts`](../../apps/web/app/api/messages/route.ts), [`messages/channels.ts`](../../apps/web/lib/messages/channels.ts), and migration `0498_message_channel_archive.sql`; channel contracts pass in [`channels.test.ts`](../../apps/web/lib/messages/channels.test.ts). Live notification/long-poll scaling remains unverified. |

### 7.3 People workbench (`attendance`)

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **People** `attendance` · `/attendance` | Who was in the shop / at the meeting. | partial | People | events → roll call | Present count from entries; member identity drives downstream hours while historic/manual names remain readable. | Presence migration `0478` adds nullable member identity without fuzzy backfill; roster taps now write `user_id`, verify org membership, and derive the display name in [`api/attendance/route.ts`](../../apps/web/app/api/attendance/route.ts). Free-text historic/manual entries remain readable. Live writer proof remains open. |
| **Hours kiosk** `hours` · `/hours` | Clock-in that feeds eligibility. | partial | People | scans → `hour_logs` → travel/drive eligibility | Scan writes log; forgotten open session auto-closes per policy. | Code-trace [GO_LIVE §6](../GO_LIVE_CHECKLIST.md); migration `0457` degrade path. Barcode-first + offline queue still weak (community). |
| **Presence** `presence` · `/presence` | One answer: RSVP → roll call → hours. | partial | People | RSVP + attendance + hours | “Who is coming tonight?” one number. | Intent in hubs.ts; unification `unverified`. |
| **My hours** `hours-self-view` · `/hours-self-view` | Own logs + who’s in. | partial | People | `hour_logs` | No public leaderboard. | FEATURE_MAP. |
| **My kit** `my-kit` · `/my-kit` | What I personally need tonight. | unverified | People | tasks + packing | Member kit from assignments | |
| **Mentor hours** `mentor-hours` · `/mentor-hours` | Adult volunteer time. | unverified | People | mentor logs | Separate from student hours | |
| **Onboarding buddy** `onboarding-buddy` · `/onboarding-buddy` | New member pairing. | unverified | People | buddy rows | Pair persists | |
| **Alumni** `alumni-network` · `/alumni-network` · `/team/alumni` | Stay in touch after graduation. | unverified | People | alumni rows | No DEMO network | |
| **Skills** `skills-graph` · `/skills-graph` | Who can run the mill. | partial | People | skills → training / checkout | Graph from logged skills only | |
| **Learning** `learning` · `/learning` | Call-your-shot / struggling view. | partial | People | predictions → skills | Metered; empty until predictions | `maxDuration` on predictions route |
| **Training matrix** `training` · `/training` | Certifications that gate tools. | partial | People | certs → tool checkout / duties | Any student cannot certify themselves. | **Nav stale claim:** now in [`hubs.ts`](../../apps/web/lib/nav/hubs.ts). Mutations are owner/admin-gated in [`api/training/route.ts`](../../apps/web/app/api/training/route.ts) through shared [`team-admin/permissions.ts`](../../apps/web/lib/team-admin/permissions.ts); contracts pass in [`compute-training.test.ts`](../../apps/web/lib/training/compute-training.test.ts). Live tool-checkout hop remains unverified. |
| **Season roles** `roles` · `/roles` | Who is safety captain. | partial | People | roles → notifications / exit | Holders are members, not free-text names. | Migration `0497_team_role_holder_identity.sql` stores nullable `holder_user_id`; role writes validate the roster and the UI selects members in [`compute-roles.ts`](../../apps/web/lib/roles/compute-roles.ts) and [`roles-client.tsx`](../../apps/web/app/roles/roles-client.tsx). Legacy free-text holders remain explicitly unlinked. |
| **Driver tryouts** `driver-tryouts` · `/driver-tryouts` | Who drives. | unverified | People | scores → roles | No invented averages | |
| **Exit interviews** `exit-interview` · `/exit-interview` | Handoff wiki page. | partial | People | response → `knowledge_pages` | Submit writes `season_handoff` page; no DEMO articles. | Self-serve token still missing (audit). |
| **Parents** `parents` · `/parents` · `/parent-view/[token]` | Families see calendar without an account. | partial | People | contacts + digest + token view | Token view is public-prefix only; bare `/parents` stays gated. | [`proxy.ts`](../../apps/web/proxy.ts) `isPublicParentView`. Recurrence in parent view tested in `parent-comms`. Live email digest `setup-only` (cron + Resend). |

**Hours kiosk standalone** `/hours/kiosk` — same job as Hours; kiosk chrome. Status `partial`.

### 7.4 Work workbench (`todos`)

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Work** `todos` · `/todos` | Season to-dos. | partial | Work | `team_todos` + `build_tasks` → canonical work-item projection | Both trackers appear in one owner/status/blocked workbench without copying rows. | Shared projection [`work-items/canonical.ts`](../../apps/web/lib/work-items/canonical.ts), service [`work-items/service.ts`](../../apps/web/lib/work-items/service.ts), and Work UI cross-tracker summary are implemented; [`canonical.test.ts`](../../apps/web/lib/work-items/canonical.test.ts) passes. Live concurrent writer proof remains open. |
| **Practice** `practice` · `/practice` | Driver cycles. | partial | Work | sessions/cycles → briefing readiness | Cycles from logs; unbounded SELECT is a scale risk | Audit LIMIT gap |
| **Season plan** `season-planning-workspace` · `/season-planning-workspace` | Goals → milestones → owners + ICS. | partial | Work | plan → calendar | Progress only from attendance / `build_tasks` | FEATURE_MAP |
| **Task board** `task-board` · `/tasks` | Kanban on `build_tasks`. | merge | Work | tasks + hours → canonical Work projection | Multi-assignee; idle members listed; Work is the cross-tracker entry point. | Survives as the build-task detail board while `/todos` owns the combined work view through [`work-items/canonical.ts`](../../apps/web/lib/work-items/canonical.ts). Hidden from the Work tool strip (`inStrip: false` in [`hubs.ts`](../../apps/web/lib/nav/hubs.ts)); Work still links **Open build board**. |
| **Goals** `goals-tracker` · `/goals-tracker` | Tracked targets. | unverified | Work | tracker rows | | Parallel to Objectives |
| **Objectives** `goals` · `/goals` | Season objectives + scorecard. | partial | Work | current/target | % blank until goals exist | FEATURE_MAP |
| **Standup** `standup-digest` · `/standup-digest` | Daily digest. | unverified | Work | tasks/hours | | |
| **Meeting agenda** `meeting-autopilot` · `/meeting-autopilot` | Agenda / minutes. | unverified | Work | calendar | | |
| **Retro** `retro` · `/retro` | What we learned. | unverified | Work | retro rows → season report | | |
| **Batteries** `batteries` · `/batteries` | Pack list + Killer Bees cart. | partial | Work **and** Build › Robot | charge logs | Break-in / over-discharge cues from logs | Shared route |
| **FMEA** `fmea` · `/fmea` | O×S×D + RPN. | partial | Work **and** Build › Robot | failures → triage / forecast | RPN only from logged scores | Shared route |
| **Tool checkout** `tool-checkout` · `/tool-checkout` | Who has the mill key. | partial | Work | checkout → training gate | Cert required if matrix says so | Gate hop `unverified` |
| **Equipment** `equipment-maintenance` · `/equipment-maintenance` | Machine upkeep (not print queue). | partial | Work | assets | Distinct from `/print-farm` | |
| **Safety** `safety-training` · `/safety-training` | PPE / certs. | partial | Work | training rows | | Overlaps `/training` |
| **Safety log** `safety` · `/safety` | Incidents. | partial | Work | incidents | Students cannot delete incidents | Audit: membership-only deletes |
| **Checklists** `checklist-library` · `/checklist-library` | SOP library. | unverified | Work | templates → pit | | |
| **Pit map** `pit-map-planner` · `/pit-map-planner` | Floor plan. | unverified | Work | map | Do not compete with Nexus pit assignment | [Audit: integrate Nexus](FEATURE_COMPLETENESS_AUDIT.md) |
| **Field reset** `field-reset-timer` · `/field-reset-timer` | Reset clock. | unverified | Work | timer | | |

### 7.5 Playbook workbench (`knowledge`)

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Playbook** `knowledge` · `/team/knowledge` | Season wiki that survives graduation. | partial | Playbook | pages → agent `knowledge.*` | Page body readable (not only raw textarea); history hits the right revisions table. | Pages now default to a formatted, safe React-rendered reading mode with an explicit Read/Edit control in [`knowledge-client.tsx`](../../apps/web/app/team/knowledge/knowledge-client.tsx); revision loading uses the wiki page/revision model. Live multi-editor proof remains open. |
| **Season roadmap** `roadmap` · `/roadmap` | Rookie “what do we do next”. | partial | Playbook | calendar template | Deadlines from season calendar helper, not invented | `season-calendar` tests exist |
| **Bring your season** `migrate` · `/migrate` | ICS / CSV / Notion in. | partial | Playbook | files → calendar/scout/hours/wiki | Scout CSV identity-locked; Notion OAuth `setup-only` | FEATURE_MAP |
| **Library** `library` · `/library` | Shared files / links. | partial | Playbook | library objects | Sharing is team vs restricted | Bytes vs storage-node `unverified` |
| **Storage node** `team-storage` · `/team/storage` | Pi holds binaries. | setup-only | Playbook | node pair → items | Unreachable node labeled, never faked | [docs/STORAGE_NODE.md](../STORAGE_NODE.md) |
| **Knowledge drafts** `knowledge-drafts` · `/knowledge-drafts` | Capture-from-work queue. | partial | Playbook | drafts → approve → wiki | Nothing publishes without Approve | |
| **Knowledge gaps** `knowledge-gap` · `/knowledge-gap` | What’s undocumented. | unverified | Playbook | wiki vs work | | |
| **Engineering notebook** `notebook` · `/notebook` | Judged notebook. | partial | Playbook | entries | Images attach (award job fails without) | Audit: text-only body |
| **Offline** `offline-shell` · `/offline-shell` · `/offline` | Cold SW + outbox honesty. | partial | Playbook | SW + IndexedDB | Precache measured; quarantined visible | `/offline` is public precache shell ([`proxy.ts`](../../apps/web/proxy.ts)) |
| **Degraded mode** `degraded-mode` · `/degraded-mode` | TBA/API outage UX. | partial | Playbook | reference health | Banners on event-day pages | |
| **Object chat** `object-chat-bridge` · `/object-chat-bridge` | Discuss a row in chat. | partial | Playbook | object link → messages | Knowledge link resolves **that** page | Message linking now validates `knowledge_pages.id + org_id`, and the composer target picker includes knowledge, goals, and risks in [`api/messages/route.ts`](../../apps/web/app/api/messages/route.ts) and [`messages/object-links.ts`](../../apps/web/lib/messages/object-links.ts). Browser/live DB proof remains open. |
| **Bus factor** `bus-factor` · `/bus-factor` | Workload concentration. | partial | Playbook | hour/task logs | Empty until logs | FEATURE_MAP |
| **Team health** `team-health-dashboard` · `/team-health-dashboard` | Engagement from logs. | unverified | Playbook | attendance/hours | No DEMO morale | |
| **Scrims** `cross-team-scrim` · `/cross-team-scrim` | Practice vs others. | unverified | Playbook | scrim rows | | |
| **Burndown** `build-burndown` · `/build-burndown` | Build progress. | unverified | Playbook | tasks | | |
| **Risk burndown** `risk-burndown` · `/risk-burndown` | Risks closing. | unverified | Playbook | risks | | |
| **Risk register** `risks` · `/risks` | Season L×I (not FMEA). | partial | Playbook | register → FMEA | Distinct from RPN | FEATURE_MAP |

---

## 8. Logistics (pillar, not a PRODUCT_HUBS id)

Drawer: [`product-nav.ts`](../../apps/web/lib/nav/product-nav.ts). Cmd+K: [`command-search.ts`](../../apps/web/lib/nav/command-search.ts) STANDALONE.

| Route | Outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| `/logistics` (`/travel` redirect) | Hotels, rooming, legs, on-duty mentors. | partial | Logistics | trips → Event day strip | No DEMO lodging | FEATURE_MAP |
| `/packing` | Competition load-out. | partial | Logistics | template → checklist | SuperPit/DS/bumper cues; no DEMO packed counts | [VANTAGE_FRC_OPS_SPEC](VANTAGE_FRC_OPS_SPEC.md) |
| `/duties` | Who is on / chaperone. | unverified | Logistics | duties → My Day | | |
| `/visit-invites` | Shop tours / RSVP. | partial | Logistics | invites → calendar | Empty until invites | FEATURE_MAP |
| `/parts-relay` | Cross-team part help (public prefix). | setup-only | Logistics / Build | relay API | Token/public rules only as documented | [`proxy.ts`](../../apps/web/proxy.ts) `/api/parts-relay` |

---

## 9. Business (`/business`)

Sponsor tabs hide when org `sponsors_allowed=false` ([FEATURE_MAP](../FEATURE_MAP.md)).

### 9.1 Overview + Money

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Overview** `overview` · `/business` | One glance: cash, asks, outreach. | partial | Overview | rollup of children | Empty until rows; never DEMO $ | Rollup honesty depends on ledger unification |
| **Money** `finance` · `/business?tab=finance` | Funding sources + purchase log. | partial | Money | CRM/grants/fundraisers/orders/costs | One spent number | Canonical spine exists in migration `0461_money_unify.sql` and [`apps/web/lib/finance/ledger.ts`](../../apps/web/lib/finance/ledger.ts). Legacy source tables remain for one-release compatibility and [`balance.ts`](../../apps/web/lib/finance/balance.ts) deduplicates mirrored rows; writer convergence and fallback retirement are still unverified. |
| **Budget** `budget` | Category plan. | partial | Money | `finance_budget_plans` | | Conflicts with season budget / BOM budget |
| **Orders** `orders` · `/orders` | PO / receive. | partial | Money | `purchase_requests` → transactions | Reconcile paid ≠ estimate | Booked at approval estimate (audit) |
| **Season costs** `costs` · `/costs` | Spend vs season budget. | partial | Money | `season_costs` mirror → canonical ledger + usage ledger | Remaining blank until budget set | Source table remains as a workflow projection; paid rows must mirror transactionally into `finance_transactions` and never count twice. |
| **Lead times** `vendor-lead-times` · `/vendor-lead-times` | When it arrives. | unverified | Money | vendor rows | | Parallel vendor model |
| **Reimbursements** `reimbursements` · `/reimbursements` | Pay a student/mentor back. | partial | Money | claims + receipts | Receipt upload; org-scoped | `maxDuration` on receipt route |
| **Vendor directory** `vendors` · `/vendors` | Where we buy. | partial | Money | directory → orders | Orders pick a vendor id, not free text | Audit: write-only address book |

`/team/finance` — **merge** into Money.  
`/bom-cost-rollup` — **partial** / **merge** into Money (fourth/fifth spend view).

### 9.2 Sponsors

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Sponsors** `sponsors` | Pipeline. | partial | Sponsors | CRM → packages / wall / writer | Empty until contacts | FEATURE_MAP |
| **Packages** `sponsorship` · `/sponsorship` | Tiers / value props. | partial | Sponsors | packages → placements | | `sponsorship_value_props` linkage `unverified` |
| **Partners** `placements` | Logo placements. | partial | Sponsors | placements → public? | Charged placement is visible where sold | Public consumer still mostly session pages (audit) |
| **Sponsor suite** `sponsor-suite` · `/sponsor-suite` | Sponsor portal. | unverified | Sponsors | suite → wall | | |
| **Sponsor wall** `sponsor-wall` · `/sponsor-wall` · `/sponsor-wall/[publicId]` | Public thank-you wall. | partial | Sponsors | published entries → public UUID | Logged-out GET `/sponsor-wall/{uuid}` and `/api/sponsor-wall/{uuid}` render published logos; builder `/sponsor-wall` stays gated. | **Public surface exists** — [`proxy.ts`](../../apps/web/proxy.ts) `isPublicSponsorWall`; page [`apps/web/app/sponsor-wall/[publicId]/`](../../apps/web/app/sponsor-wall/[publicId]/page.tsx). Audit “no public surface” is **stale**. Live published wall `unverified`. |
| **Renewal ROI** `sponsor-renewal-roi` · `/sponsor-renewal-roi` | Renew the ask. | unverified | Sponsors | contributions → ask | | Satellite |
| **Tier calculator** `sponsor-tier-calculator` · `/sponsor-tier-calculator` | How much to ask. | unverified | Sponsors | calculator | | Satellite |
| **Matching gifts** `matching-gift-finder` · `/matching-gift-finder` | Employer match. | unverified | Sponsors | finder | | Satellite |

`/team/sponsors` — **merge** into Sponsors CRM.

### 9.3 Grants

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Grants** `grants` · `/team/grants` | Pipeline + guided writing. | partial | Grants | apps → writer | Metered assist; empty/setup | Export/copy-all still weak |
| **Reports** `grant-report` · `/grant-report` | Tell **this** funder how **their** money was spent. | partial | Grants | grant-linked transactions → report | Report spend equals tagged expenses; if linkage is unavailable, explicit empty — **not** the whole season. | The unsafe season-total query was removed: [`compute-grant-report.ts`](../../apps/web/lib/grant-report/compute-grant-report.ts) now reports `$0` with `spendAttribution: "setup_required"` and explicit disclosure instead of attributing unrelated expenses. Contract: [`compute-grant-report.test.ts`](../../apps/web/lib/grant-report/compute-grant-report.test.ts). A grant-transaction linkage schema and live report remain open. |
| **Eligibility** `grant-eligibility-matcher` · `/grant-eligibility-matcher` | Which grants fit. | partial | Grants | profile → matches | Deadline awareness; no invented awards | Dataset freshness `unverified` |
| `/team/grants/calendar` | Grant deadlines. | unverified | Grants | calendar API | | Cron `grant-deadline-alerts` `setup-only` |

### 9.4 Outreach

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Outreach** `evidence` | Evidence home. | partial | Outreach | activities → awards | | |
| **Fundraisers** `fundraisers` · `/fundraisers` | Event + deposits. | partial | Outreach | deposits/goals | Progress from recorded $ only | No expense side (audit) |
| **Impact** `impact` · `/impact` | Outreach log / hours. | partial | Outreach **and** Media | activities → essay/awards | Hours blank until activities; photos still weak | Shared route |
| **Award tracker** `award-tracker` · `/award-tracker` | Deadlines. | merge | Outreach | tracker vs `award_submissions` | | Duplicate of Awards |
| **Awards** `awards-workbench` · `/team/awards` | FIRST submission from evidence. | partial | Outreach | items → export | Copy-all / PDF / portal paste | Audit: no export |
| **Impact essay** `impact-essay` · `/impact-essay` | Draft that attaches to an award. | partial | Outreach | draft → `award_items` | Attach action exists | Historically a dead end |
| **Judge pitch** `judge-sim` · `/judge-sim` | Practice with **existing** evidence. | partial | Outreach | impact/awards → sim | No fourth evidence store | |
| **Media kit** `media-kit` · `/media?tab=kit` | Press/sponsor kit. | partial | Media kit | kit assets | Deep-link from Business | Template-as-AI risk |
| **Outreach calendar** `outreach-calendar` · `/outreach-calendar` | Planned outreach. | partial | Outreach | events → impact on complete | Complete creates `impact_activities` | Audit: island copy of impact |

**Showcase** `/showcase`, `/showcase/present` — standalone awards story. Status **partial** (client comments claim the practice-session/`deckId` bug was addressed; no test cited here). Public prefix `/showcase/present`, `/api/showcase/public`.  
**Mock judging** `/mock-judging` — **merge** into Judge pitch.  
**Recognition** `/recognition`, **Leadership** `/leadership` — **unverified** / hide until they write playbook or awards.

---

## 10. Build (`/build`)

### 10.1 Kickoff + CAD + Code

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Kickoff** `kickoff` · `/kickoff` | Game → priorities / questions. | partial | Kickoff | manual text → board | Intelligence path honest if template/local | `localIntelligenceAdapter` / costUsd 0 still an honesty risk; [`kickoff/intelligence`](../../apps/web/app/api/kickoff/intelligence/route.ts) has `maxDuration` |
| **CAD** `cad` · `/cad` · `/build?tab=cad` | Bind Onshape (or local Fusion) and change a real part. | setup-only | CAD | OAuth / browser session / `vantage-cad` → jobs → build purchase request | Brief → plan → approve → native sketch/extrude/Part Studio/assembly/instance/mate on a **disposable** doc; viewport shows a real shaded view or “open in Onshape”, not a blocked iframe. | Native editable operations and browser-session auth are implemented and contract-tested without FeatureScript. Connections [`/cad/connections`](../../apps/web/app/cad/connections/page.tsx), setup [`/cad/setup`](../../apps/web/app/cad/setup/page.tsx), CLI docs [CLAUDE_CODE_CAD.md](../CLAUDE_CODE_CAD.md). **Live block:** this machine has no saved Onshape browser session; the available live MCP credential returned 401. Fusion still requires the local add-in. |
| **CAD vault** `cad-vault` · `/cad-vault` | “Where is the printable STL/STEP?” | partial | CAD | multipart → `cad_documents` / versions → subsystems / print farm | Upload STL/STEP; version list; download bytes; link subsystem; quota enforced. | **Vault exists** — UI [`apps/web/app/cad-vault/`](../../apps/web/app/cad-vault/page.tsx), API [`/api/cad-vault`](../../apps/web/app/api/cad-vault/route.ts), versions + file + thumbnail, lib [`apps/web/lib/cad-vault/`](../../apps/web/lib/cad-vault) (format-detect / quota / geometry tests), manifest [`cad-vault.manifest.ts`](../../apps/web/lib/manifests/cad-vault.manifest.ts). Audit “no import at all” is **stale**. Production bytes `unverified`. |
| **Change radar** `cad-change-radar` · `/cad-change-radar` | What changed in CAD. | unverified | CAD | CAD API | | setup-only without connection |
| **Sketch to brief** `sketch-to-brief` · `/sketch-to-brief` | Napkin → CAD brief. | unverified | CAD | image → brief | | |
| **Code** `code` · `/code` | Pattern review + teach-not-do. | partial | Code **and** AI › Notes | pasted source / GitHub | Local rules fire (incl. supply current limit); AI optional + cutoff | FEATURE_MAP |
| **Get unstuck** `troubleshoot` · `/troubleshoot` | Comms / imaging / brownout. | partial | Code | symptoms → coach | Honest local vs metered | |
| **AI Bugbot** `bugbot` · `/bugbot` | Review **the scanned repo**, fix that source, charge Ultra only for that. | partial | Code **and** AI › Notes | GitHub tree → findings → human-approved diff | After a repo scan, Fix uses `resolveBugbotTarget` → `useRepo` + pinned sha, **not** the sample textarea. Recheck re-scans head. | **Retargeting fixed** — [`apps/web/lib/bugbot/grounding.ts`](../../apps/web/lib/bugbot/grounding.ts), tests [`grounding.test.ts`](../../apps/web/lib/bugbot/grounding.test.ts), client [`code-client.tsx`](../../apps/web/app/code/code-client.tsx). Code-trace [GO_LIVE §8](../GO_LIVE_CHECKLIST.md). File-cap / write-PR / `context: []` still open. GitHub `setup-only`. |
| **Deploy log** `code-deploy-log` · `/code-deploy-log` | What is on the robot. | unverified | Code | deploy rows | | |
| **Team agent config** `agent-config` · `/team/agent-config` | CLAUDE.md / MCP bundle for the team. | setup-only | Code | bundle API + device token | Pair or session required | [docs/AGENT_CONFIG.md](../AGENT_CONFIG.md); public prefix `/api/agent-config/bundle` |
| **Code vs match** `code-perf` · `/code-perf` | Loop time vs match. | unverified | Code | perf rows × TBA | | |

**CAD extras (not hub tabs, still product):**

| Route | Outcome | Status | Workbench | Notes |
|---|---|---|---|---|
| `/cad/setup` | Wizard | setup-only | CAD | Do not default to mock in production UX |
| `/cad/connections` | Account integrations | setup-only | CAD / Account | TBA / Onshape / Google / Discord / Slack / GitHub |
| `/cad/pair` | Desktop CLI pair | setup-only | CAD | |
| `/cad-review-queue` | Design review queue | unverified | CAD | Manifest `cad-review-queue` |
| `/editor/pair` | VS Code / editor connector | setup-only | Code | `/api/editor/pair/*` public prefix |
| `vantage-cad` CLI · `.mcp.json` | Terminal Onshape/Fusion | setup-only | CAD | [CLAUDE_CODE_CAD.md](../CLAUDE_CODE_CAD.md); disposable docs |
| `packages/fusion360-official-connector` | Fusion add-in | setup-only | CAD | Loopback; unsigned desktop until certs |

### 10.2 Robot workbench (`fmea` root = Robot)

FMEA table is the risk register for mechanisms; **Blueprint** is featured.

| Tab | Route | Outcome | Status | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| Robot (FMEA root) | `/fmea` | Failure modes | partial | failures → triage/forecast | See §7.4 | Shared |
| Blueprint | `/robot` · `robot` | Subsystem map | partial | `robot_subsystems` → CAD/vault | missingCad counts URL **or** vault row | Vault hook `unverified` |
| Subsystem specs | `/subsystems` | Spec sheet | partial | same table as blueprint | One field set, not two pages fighting | Audit disjoint columns |
| Bring-up | `/bringup` | First power | unverified | checklist | | |
| Design reviews | `/reviews` | Sign-off | unverified | reviews → decisions | | |
| Gearbox calculator | `/gearbox` | Ratio / free speed | partial | saves | Update in place, not duplicate-insert | Audit INSERT-only |
| Shooter table | `/shooter-table` | RPM / hood | partial | table → robot code export | Download constants | No export (audit) |
| Weight budget | `/weight-budget` | Planned lb | partial | components | Closed vs weigh-in | Three weight systems (audit) |
| Power budget | `/power-budget` | 120A / breakers | partial | logged loads | Cues from real ratings only | FEATURE_MAP |
| Prototypes | `/prototype-tracker` | Idea tests | partial | proto rows | Photos still missing | |
| Batteries | `/batteries` | Packs | partial | logs | Shared with Team | |
| Inspection | `/inspection-copilot` | Pass inspection | partial | logged statuses | BOM / radio-PD / USB-C / 2026 cues gated on logs | FEATURE_MAP |
| Weigh-in | `/robot-weigh-in` | Scale vs limit | partial | entries + TBA elims | Playoff re-weigh cue only if TBA has unplayed elims | |
| Readiness | `/readiness-score` | Ship index | partial | private tables vs subsystems | Should read robot + inspection, not a third universe | |
| Wiring check | `/wiring-diagnoser` | Expected vs observed PDH | partial | circuits | 4 AWG cue only when logged | Tests in `wiring-diagnoser.test.ts` |
| CAN-bus map | `/wiring` | Device map | partial | map | Export for inspector | |
| Rule impact | `/rule-impact` | Manual Δ × last robot | partial | rules × subsystems | still-legal / rework from logs | |
| Tuning advisor | `/tuning-autopilot` | Next gain | partial | iterations | Suggestions from logs only | |
| Tuning log | `/tuning` | Constants history | partial | upsert | History table (not overwrite) | Audit overwrite |
| Failure patterns | `/failure-patterns` | Recurring breaks | unverified | FMEA | | |
| Incidents | `/incident-heatmap` | Where it breaks | unverified | incidents | | `/incidents` standalone **merge** |
| Auton paths | `/auton-path-library` | Path library | unverified | paths | | `/auto-routines` **merge** |
| Reuse | `/reuse-advisor` | Carry-over | unverified | last season | | |
| Spares forecast | `/spare-forecast` | Will we run out | partial | inventory × FMEA | Offseason must not report “no risk” from a 200-day clamp | Audit inert forecast |
| Manufacturing | `/manufacturing` | Needs CAM → done | unverified | jobs × vault | | |
| Print farm | `/print-farm` | Queue / printers / filament | partial | jobs × filament ledger | No slicer/telemetry claim; ETA null without estimates | **Exists** (audit “printing does not exist” **stale**). Human layer only. |
| Consumables | `/spares` | Zip ties / Loctite | partial | `consumables.on_hand` | Moves go through one parts ledger | Parallel quantity store |
| Spare kit | `/spare-robot-kit` | Event spare robot | unverified | kit × packing | | |
| Bin locator | `/bin-shelf-locator` | Where is it | partial | locations | QR agrees with Inventory | Two QR schemes (audit) |
| Budget check | `/budget-reconciler` | Spend vs plan | merge | Money | | Third finance view |
| Pack health | `/battery-health-forecast` | Dying packs | unverified | logs | | |
| Cross-domain | `/cross-domain-alerts` | Joined warnings | unverified | many tables | The differentiator job — only if joins are real | |
| Decision critic | `/decision-critic` | Second opinion | partial | rules not LLM | Honest “scoring rule” label | Also AI › Notes satellite |

**Also list:** `/inspection` (older checklist — **merge** into Inspection copilot; still linked from FMEA). `/control-map` (button bindings — **partial**, FEATURE_MAP). `/software-versions` (**unverified**). `/subsystem-signoff` (**unverified**). `/inventory` (settings deep link — **partial**, unify with parts). `/season-rollover` (**unverified**).

---

## 11. AI (`/ai`)

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| **Chat** `chat` · `/chat` | Metered FRC assistant with **history** and tools. | partial | Chat | BYOK/bridge/platform → `meteredAI` → usage | Prior turns sent to the model; cutoff banner; no DEMO replies. | Resolver code-trace [GO_LIVE §7](../GO_LIVE_CHECKLIST.md). History-to-model still an audit defect unless a new test says otherwise. Production BYOK needs KMS. |
| **Writer** `writer` · `/writer` | Grant/sponsor draft from **this org’s** profile. | partial | Writer | profile + awards/outreach | Empty shells; cutoff on Assistant | `autoTools: false` (audit) |
| **Agent** `agent` · `/api/agent/autonomous` | ReAct loop with persisted steps. | partial | Agent | tools + `autonomous_agent_runs` | History empty if none; no raw HTML/secrets; `maxDuration=300` declared | Hosting plan must honor duration ([GO_LIVE blocker 8](../GO_LIVE_CHECKLIST.md)) |
| **Controls** `budgets` · `/team/budgets` | Caps, allowlist, kill switch. | partial | Controls | policy → every AI route | Forbidden shell for non-admin | Turning allowlist on must not drop CAD/strategy tools |
| **Memory** `memory` · `/team/ai-memory` | Opt-in team memory + dream journal. | partial | Controls | memories / dreams | Counts from Neon; no DEMO | Dream cron **setup-only** (external ticker) |
| **Governance** `governance` · `/team/ai-policy` | Feature/tool allowlists. | partial | Controls | policy | | |
| **Finance (AI)** `finance` · `/ai?tab=finance` | Redaction consent. | partial | Controls | consent off → no ledger in prompts | Honest empty/off | Not Business Money |
| **API keys** `ai-keys` · `/team/ai-keys` | Mine vs Team BYOK. | setup-only | Controls | KMS envelope | Save fails honestly without KMS | [GO_LIVE §7](../GO_LIVE_CHECKLIST.md) |
| **Subscription bridge** `ai-bridge` · `/team/ai-bridge` | Mentor CLI pays $0 API. | setup-only | Controls | device pair → jobs | Coverage `chat` vs `everything`; rate-limit falls back to keys | [docs/AI_BRIDGE.md](../AI_BRIDGE.md); `/api/ai-bridge/device/*` |
| **BYOK usage** `ai-usage` · `/team/ai-usage` | Key usage. | unverified | Controls | ledger | | |
| **Usage** `usage` · `/team/usage` | Metered calls / denials. | partial | Controls | ledger | No DEMO activity | |
| **Notes** `decisions` · `/decisions` | ADR log. | partial | Notes | records → search | Empty until logged | |
| **Search** `decision-search` · `/decision-search` | Semantic search. | setup-only | Notes | embeddings + meter | Empty + cutoff | |
| **Season report** `season-report` · `/season-report` | Year in review from **logged** rows. | partial | Notes | many tables → snapshot | Must not require retyping the season | Audit: still hand-typed; `maxDuration=300` |
| Code assist / Bugbot | `/code` `/bugbot` | see Build | Notes | same routes | | |

`/team/ai-hub` — **merge** (redirect to `/ai?tab=chat`). `/team/ai-runs`, `/team/prompts` — **unverified** / hide. `/api/dreams` — setup-only cron.

**Honesty rule:** a feature that wraps a template in `meteredAI` with `costUsd 0` stays `partial` and must not be labeled as a model result. Do not mark `verified` because a badge says AI.

---

## 12. Media (`/media`)

| Tab / routes | FRC outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| Calendar | `/media` `calendar` | Post schedule | partial | content items | Empty until items | Items historically title/caption only |
| Drafts | `drafts` | Caption drafts | partial | metered captions | Cutoff banner | |
| Reminders | `reminders` | Due posts | partial | reminders | | Cron `setup-only` |
| Kit | `kit` · `/media-kit` | Brand pack | partial | assets | | One-pager template risk |
| Media library | `media-library` · `/media-library` | Photos/videos | partial | library API | Real bytes, not captions only | |
| Impact | `impact` · `/impact` | Same as Business impact | partial | activities | Shared route | |

---

## 13. Home, account, onboarding, public, displays

| Route | Outcome | Status | Workbench | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| `/dashboard` | Personal home; live widgets only | partial | Home | widgets from real rows | Empty cards off until Edit Home; island four apps | FEATURE_MAP; no DEMO widget metrics |
| `/workspace` | Workspace switcher | unverified | Home | orgs | | |
| `/notifications` · `/notifications/preferences` | Inbox | partial | Home | `emitPreferredNotification` | Chat must not write 40 rows/message at scale | |
| `/search` | In-app search | unverified | Home | `/api/search` | Cmd+K is local; this is data search | |
| `/account` | Profile, phone OTP, integrations tab | setup-only | Settings | Twilio / OAuth | Connected only from real rows | FEATURE_MAP Connections |
| `/security` | MFA / sessions | setup-only | Settings | email 2FA | Resend `setup-only` | |
| `/team/admin` | Members, exact-email invite | partial | Settings | invites → `/invite` | Always ≥1 admin; copyable invite link if email unconfigured | [GO_LIVE §2](../GO_LIVE_CHECKLIST.md) code-trace |
| `/team/security` | Hub allowlists | partial | Settings | `membership_hub_access` | Unrestricted when no rows | FEATURE_MAP |
| `/team/data` | Team data | unverified | Settings | | | |
| `/team/background` | Funding profile / sponsors_allowed | partial | Settings | `funding-profile` API | | |
| `/team/getting-started` | Bootstrap | unverified | Settings | | | |
| `/team/audit` · `/team/posture` | Team audit/posture | unverified | Settings | | | |
| `/exports` | Audited takeout | partial | Settings | export-center | Keys never included; `EXPORT_ENCRYPTION_KEY` in prod | [GO_LIVE §10](../GO_LIVE_CHECKLIST.md) |
| `/docs` · `/docs/[slug]` · `/help` · `/help/[slug]` | App manual | partial | Support | `/help` → `/docs` | | Redirect in legacy-redirects |
| `/support` · `/support/[publicId]` | Tickets; public partner storefront | partial | Support | | Public UUID only | `isPublicPartnerStorefront` |
| `/report-bug` | In-product bug | unverified | Support | | | |
| `/onboarding` · `/start` | Role + crew + legal | partial | Gate | `completeOnboarding` | Both legal literals; team number does not auto-join | [GO_LIVE §1](../GO_LIVE_CHECKLIST.md) |
| `/consent` | Event consent | unverified | Event readiness | | | Merge into event-readiness |
| `/claim` | Self-serve unused TBA number | partial | Public/gate | `claim_frc_team_workspace` | Verified email; STIMS remains official | |
| `/invite` | Preview + accept | partial | Public | token | Accept requires invited session | Public page |
| `/signin` · `/sign-in` | Google + email OTP | setup-only | Public | Better Auth | | |
| `/parent-view/[token]` | Guardian read-only | partial | People | token | | See Parents |
| `/display` · `/display/kiosk` · `/display/pit` | Pit TV / kiosk | partial | Display | TBA snapshot public prefix | Queue/bumper from TBA; widgets blank until rows | FEATURE_MAP; do not compete with PitFUSION/Nexus as a product |
| `/offline` | SW precache shell | partial | Playbook | public page | | |
| `/desktop` | Marketing + download | unverified | Public | | Unsigned NSIS | [DESKTOP.md](../DESKTOP.md) |
| `/desktop-link` | Browser-link sign-in | setup-only | Desktop | `/api/desktop/link*` | | |
| `/` `/features` `/features/cad` `/features/strategy` `/features/code` `/for-teams` `/pricing` `/privacy` `/terms` `/workflow` `/whats-new` | Marketing / legal | n/a (not product DoD) | Public | | Never claim verified product jobs | |
| `/strategy/draft` | Pick-list / board editor | merge | Strategy | Same job as pick list + desk | Do not become a third list |
| `/strategy/board` | Public/share board (`/api/strategy/draft/public`) | setup-only | Strategy | Token/public prefix only | [`proxy.ts`](../../apps/web/proxy.ts) |
| `/match-debrief` | Post-match debrief (metered, `maxDuration=300`) | unverified | Event day / Strategy | Must write notes/cards, not a fourth brief | |
| `/team/discord` · `/team/slack` | Outbound bridges | setup-only | Chat | Announce mirror; YPP stays in Vantage | |
| `/team/knowledge/history` | Wiki revisions | partial | Playbook | Must point at the real revisions table | Audit: wrong table risk |
| `/calendar` | Alias of team calendar if still routed | merge | Calendar | Prefer `/team?tab=calendar` | |

---

## 14. Platform admin

All require `platform_admins`. No DEMO partner counts.

| Route | Outcome | Status | Workbench | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|
| `/admin` | Team manager | unverified | Admin | Provision org + owner | [GO_LIVE §2](../GO_LIVE_CHECKLIST.md) code-trace only |
| `/admin/partners` | App sponsor / AI partner CRM (no API keys) | unverified | Admin | | |
| `/admin/outreach` | Org outreach CRM-lite | unverified | Admin | | |
| `/admin/models` | Model vault + smoke links | setup-only | Admin | | |
| `/admin/sponsored` | Sponsored AI | unverified | Admin | | |
| `/admin/waitlist` | Waitlist | unverified | Admin | | |
| `/admin/audit` | Admin audit | unverified | Admin | | |
| `/admin/analytics` | Platform analytics | unverified | Admin | | |
| `/admin/commercial` | Commercial | unverified | Admin | | |
| `/admin/connectors` | Connectors | unverified | Admin | | |
| `/admin/support` | Support queue | unverified | Admin | | |
| `/admin/releases` | Releases | unverified | Admin | | |
| `/admin/plans` | Plans | unverified | Admin | | |

---

## 15. Desktop, CAD CLI, storage, free-relay

| Surface | Outcome | Status | Canonical | Up → down | Acceptance | Evidence / blocker |
|---|---|---|---|---|---|---|
| `apps/desktop` | Windows shell around hosted web | setup-only | `/desktop` | session in `persist:vantage` | Signed-out gate; allowlisted nav; `vantage-frc://open/<path>` | [DESKTOP.md](../DESKTOP.md). Unsigned. Not a second backend. |
| `vantage-cad` / MCP | Real Onshape/Fusion from terminal | setup-only | [CLAUDE_CODE_CAD.md](../CLAUDE_CODE_CAD.md) | API keys or loopback add-in | Disposable doc first | Onshape annual call caps |
| Storage node `packages/storage-node` | Bytes on team hardware | setup-only | `/team/storage` | pair + heartbeat | 507 at quota; unreachable labeled | [STORAGE_NODE.md](../STORAGE_NODE.md); `server.test.ts` |
| `packages/free-relay` | Free/local job relay | unverified | scripts/pi | | Do not claim production worker | Uncommitted package in tree at inventory time |
| `packages/vantage-vscode` | Editor extension | setup-only | `/editor/pair` | | | |
| `packages/ai-bridge` | Subscription bridge lib | setup-only | `/team/ai-bridge` | | | |

---

## 16. Packages (domain, not pages)

Status = library completeness, not a user job. None `verified` against production.

| Package | Job | Status | Notes |
|---|---|---|---|
| `@vantage/db` | Schema, `withRls`, migrations | partial | RLS untested on live host ([GO_LIVE](../GO_LIVE_CHECKLIST.md)) |
| `@vantage/core` | Auth, tenancy, invite, notifications | partial | |
| `@vantage/billing` | `meteredAI`, ledger, BYOK envelope | partial | Pre-flight estimated cost historically hardcoded |
| `@vantage/reference` | TBA / Statbotics cache + workers | setup-only | ETag worker; event-day freshness `unverified`; do not roll a rival EPA |
| `@vantage/scouting` | Schemas, repository, QR | partial | |
| `@vantage/prediction-strategy` | pEPA, pick helpers, `scout-ops` mapping | partial | Mapping improved; `rateTeam` / `citeMatchResults` may still be unused |
| `@vantage/intel-research` | Intel | unverified | |
| `@vantage/cad` | Onshape/Fusion agent actions | partial | Many declared ops still thin |
| `@vantage/agent` | Chat/orchestrator/Bugbot | partial | |
| `@vantage/export-center` | Takeout adapters | partial | Purple Standard adapter shipped per roadmap |
| `@vantage/import` | Season import | partial | |
| `@vantage/game-year` | Default match/pit schemas | partial | Must stay aligned with `scout-ops` inference |
| `@vantage/connector` | Connectors | unverified | |
| `@vantage/ai-bridge` | Bridge | setup-only | |
| `vantage-cad-cli` | CLI | setup-only | |
| `fusion360-official-connector` | Fusion | setup-only | |
| `free-relay` | Relay | unverified | |

---

## 17. Integration readiness matrix

| Integration | Config | Used by | Readiness | Test evidence required | Do not |
|---|---|---|---|---|---|
| **TBA** | API key + ingest worker | Schedule, rankings, scouting, strategy, displays, calendar matches | setup-only | ETag/backoff worker log; event-day refresh **during quals** (not only 14:00 UTC cron); empty when cache cold | Parallel unrestricted polls |
| **Statbotics EPA** | Worker → `team_event_metrics` | Strategy, pick clock, districts | setup-only | Cache row present; never compute a rival EPA | Invent EPA |
| **Nexus** | — | Consume if/when wired | unverified | Webhook signature + pit assignment | Rebuild queue/pit-map product |
| **Onshape** | OAuth / API / browser session | `/cad`, vault export hook, CLI | setup-only | Disposable doc: sketch+extrude checkpoint; quota remaining shown | Point first run at competition robot |
| **Fusion 360** | Local add-in + `vantage-cad` | CAD | setup-only | Loopback pair; part appears in Fusion | Claim hosted Fusion |
| **GitHub** | OAuth, read-only today | Bugbot, Code | setup-only | Scan pinned sha; fix retarget test already unit-level | Auto-push diffs |
| **Google** | OAuth | Calendar/import | setup-only | | Replace Workspace |
| **Discord / Slack** | `/team/discord` `/team/slack` | Announce mirror | setup-only | Outbound only; YPP still in Vantage | Demand Discord death |
| **Notion** | `NOTION_CLIENT_ID` | `/migrate` | setup-only | | |
| **Stripe** | Keys + webhook | Billing | setup-only | Webhook `{"received":true}` | |
| **Resend** | Domain | OTP, invites, parent digest | setup-only | Real OTP received | |
| **Twilio** | SMS OTP | Account | setup-only | | |
| **AWS KMS** | `AWS_KMS_KEY_ID` | BYOK | setup-only | Save key in a non-prod env with KMS | Local KMS in production |
| **AI providers** | Platform / BYOK / bridge | Chat, writer, agent, Bugbot Ultra | setup-only | Provenance `keySource`; cutoff | Template labeled as model |
| **ICS feeds** | Token path | Calendar subscribe | partial | Only `/api/calendar/feed/<token>` public | Session JSON public |
| **Desktop link** | `/api/desktop/link*` | Electron | setup-only | | |
| **Storage node** | Pair code | Library / media bytes | setup-only | Heartbeat degraded/offline labels | Fake availability |
| **AI bridge device** | Pair code | Chat/everything | setup-only | Rate-limit fallback | Unlimited pool |
| **Editor pair** | Device code | VS Code | setup-only | | |
| **Parts relay** | Public prefix | Spare sharing | setup-only | | |
| **Sponsor wall public** | UUID | Sponsors | partial | Logged-out fetch of published id | Treat builder URL as public |
| **Parent view** | Opaque token | Families | partial | Token regex only | Ungate `/parents` |
| **Showcase public** | Token | Awards | partial | | |
| **Display snapshot** | Public prefix | Pit TV | partial | | |

**Cron / hosting:** Hobby two-cron limit vs many `/api/cron/*` routes is an ops blocker ([GO_LIVE](../GO_LIVE_CHECKLIST.md)), not a page bug. Dreams, parent digest, sponsor reminders, grant alerts stay `setup-only` until a ticker or plan is evidenced.

---

## 18. Test evidence requirements (by job family)

Do not paste green CI as proof of a family unless the named file ran.

| Family | Minimum evidence | Known unit files (not a pass claim) |
|---|---|---|
| Offline / outbox | 120-entry drain + poisoned row isolated + old client >100 documented | [`apps/web/lib/scout-offline.test.ts`](../../apps/web/lib/scout-offline.test.ts) |
| Semantic mapping | Default schema + `Auto Points` label → non-null auto; explicit `none` stays null | `packages/prediction-strategy` scout-ops tests if present — do not invent a pass |
| CAD vault | Magic-byte reject + quota + org-prefixed storage key | [`format-detect.test.ts`](../../apps/web/lib/cad-vault/format-detect.test.ts), [`quota.test.ts`](../../apps/web/lib/cad-vault/quota.test.ts), [`filenames.test.ts`](../../apps/web/lib/cad-vault/filenames.test.ts), [`stl-geometry.test.ts`](../../apps/web/lib/cad-vault/stl-geometry.test.ts), [`view.test.ts`](../../apps/web/lib/cad-vault/view.test.ts) |
| Calendar recurrence | Weekly series + this-occurrence exception + migrate-unapplied degrade | [`recurrence.test.ts`](../../apps/web/lib/calendar/recurrence.test.ts), [`series.test.ts`](../../apps/web/lib/calendar/series.test.ts), [`ics-recurrence.test.ts`](../../apps/web/lib/calendar/ics-recurrence.test.ts), [`parent-comms/view.test.ts`](../../apps/web/lib/parent-comms/view.test.ts) |
| Bugbot retarget | Fix after repo scan uses pinned sha; buffer scan stays on buffer; unpinned sha null | [`apps/web/lib/bugbot/grounding.test.ts`](../../apps/web/lib/bugbot/grounding.test.ts) |
| Sponsor wall public | Logged-out GET of published UUID; builder `/sponsor-wall` still 302/401 | [`proxy.ts`](../../apps/web/proxy.ts) `isPublicSponsorWall`; no invented browser pass |
| Hours kiosk | Scan → `hour_logs`; missing `0457` returns setup copy | [GO_LIVE §6](../GO_LIVE_CHECKLIST.md) is code-trace only |
| Pick list hop | Collab/desk/clock share one `pick_lists` id | Not evidenced. Do not cite GO_LIVE §4 as unification |
| Grant report | Spend query filters `grant_application_id`; empty tagged set ≠ season total | Current compute safely refuses attribution and tests the disclosure; grant-linked transactions are still needed |
| Tenancy | Two orgs; cross-read empty | Credential-free unit tests are not this. Live Postgres required |
| Metered AI | Cap denial + ledger row + no mid-flight kill | `maxDuration` declared ≠ plan honors it |
| Desktop | Sign-in gate + deep link after session | [DESKTOP.md](../DESKTOP.md); unsigned SmartScreen is expected |
| Event-day shells | Phone/tablet/desktop scouting/offline/strategy | Roadmap cites `tests/browser/event-day-shells.spec.ts` — treat as QA, not `verified` |

Browser family: Playwright or a dated manual script. A single screenshot is not evidence. If browser tools were not used in the PR, write `not run`.

---

## 19. Confirmed gaps (P0 / P1 / P2) and stale-audit corrections

Priority = FRC job blocked, not ticket count. **Corrected claims come first** so nobody re-opens finished work.

### 19.1 Stale audit / research claims — do not treat as current P0

| Stale claim (source) | Current fact | Ledger status |
|---|---|---|
| Offline outbox has **no chunking**; >100 entries 400 forever ([FEATURE_COMPLETENESS_AUDIT](FEATURE_COMPLETENESS_AUDIT.md) “Broken”) | **New clients** slice at 50 and request per-entry results ([`scout-offline.ts`](../../apps/web/lib/scout-offline.ts)). Server still rejects oversized **single** batches. | `partial` — not `broken` for new clients. Old cached JS can still wedge. No regional soak. |
| Scout → strategy keys never match default `auto_score` (same audit) | **Semantic mapping improved**: `normalizeSignalKey`, `inferRoleForFieldKey`, `resolveSignal` ladder in [`scout-ops.ts`](../../packages/prediction-strategy/src/scout-ops.ts). | `partial` — default form no longer all-null by case. Unmapped custom labels still need `config.role`. |
| CAD document / STL import does not exist (same audit) | **CAD vault exists**: `/cad-vault`, `/api/cad-vault`, version/file/thumbnail routes, [`apps/web/lib/cad-vault/`](../../apps/web/lib/cad-vault). | `partial` — not `broken`. No prod byte proof. |
| No recurring calendar events / no rrule (audit + [COMMUNITY_DEMAND_RND](COMMUNITY_DEMAND_RND.md) rows 88, 104) | **Recurrence exists**: rrule/series/exceptions, ICS helper, calendar route degrade if `0456` missing. | `partial` — those docs are stale on this point. |
| Sponsor wall has no public surface (audit) | **Public wall exists** at `/sponsor-wall/{uuid}` + matching API ([`proxy.ts`](../../apps/web/proxy.ts)). Builder stays gated. | `partial` — not `broken`. Live published wall unverified. |
| After repo scan, $2 fix hits the textarea / sample ([audit](FEATURE_COMPLETENESS_AUDIT.md) Bugbot Ultra) | **`resolveBugbotTarget` retargeting is fixed** ([`grounding.ts`](../../apps/web/lib/bugbot/grounding.ts) + tests + `code-client.tsx`). | `partial` — billing-target bug closed at the client resolver. File-cap / PR write still open. |
| `/training` and `/roles` unreachable (audit) | Both are Team › People tabs in [`hubs.ts`](../../apps/web/lib/nav/hubs.ts) and Cmd+K. Training mutations are owner/admin-only; roles now store nullable roster `holder_user_id`. | `partial` — reachability, permission, and new holder identity defects are closed; live downstream proof remains open. |
| Fourteen scout-* nest items + Work/Task board as sibling chips (audit item 14) | Scouting strip is Forms · Coverage · Shifts · Pit mesh · Training · Field value · Data quality. Eight meta routes stay registered with `inStrip: false`. `/tasks` stays; Task board is off the Work strip (`hubStripTabs`). | `partial` / `merge` — nav crowding closed; tables are not merged. |
| Form builder has only eight types, no counter/timer/rating (audit) | Builder lists counter, multi_counter, timer, rating, multi_select, slider, field_position, section ([`form-builder.ts`](../../apps/web/lib/scouting/form-builder.ts)). | `partial` — type-count claim stale. |
| 3D printing does not exist (audit) | `/print-farm` is a Build › Robot tab with queue/printers/filament (no telemetry). | `partial` — absence claim stale. |
| Three competing pre-match briefs including `/match-copilot` (audit) | `/match-copilot` **redirects to `/briefing`**. | Briefing `partial`; copilot row is `merge`. `/command` is still a second brief. |

### 19.2 P0 — blocks a competition weekend, money truth, or trust

| ID | Gap | Why P0 | Status | Canonical fix target |
|---|---|---|---|---|
| P0-1 | Coverage live-event proof | Lineup and Scout Coverage Live now share one schedule/assignment/entry compute, but no real event has exercised assignment, threshold, nudge, and polling together | partial | Run a live-event assignment/nudge/poll exercise and attach the dated evidence pack |
| P0-2 | Grant report spend attribution | The incorrect whole-season attribution is closed; reports now refuse to total until a grant-specific transaction link exists | partial | Add the grant-transaction linkage, then prove a tagged and an untagged expense in staging |
| P0-3 | Canonical pick-list live proof | Collab, Chemistry, desk, justifier, and Pick Clock now project/write the `pick_lists` spine; a live concurrent draft exercise is still absent | partial | Run one event list through collab reorder → chemistry promote → clock POST/undo → desk board |
| P0-4 | Finance compatibility retirement | `finance_transactions` is the canonical ledger and source writers mirror transactionally, but legacy projections remain for one release | partial | Prove no double-count in staging, then retire fallback reads |
| P0-5 | Chat live district-scale proof | Channels, supervised DMs, newest-first cursor history, archive, and audited export exist; fan-out and long-poll behavior are not load-tested | partial | Run multi-channel notification/export load and youth-policy acceptance in staging |
| P0-6 | Production host unproven | Migrations / live RLS / legal / cron / KMS / Resend open in [GO_LIVE](../GO_LIVE_CHECKLIST.md) | unverified | Dated prod evidence — **do not mark product rows `verified` until this moves** |
| P0-7 | Old scout clients + media last-mile | Cached JS can still POST >100; pit photos historically unlinked / no thumb | partial | Force SW update; media `entry_id` + thumb + offline cache |
| P0-8 | Parts/spares live proof | Pit-repair resolution now consumes the unified inventory ledger idempotently; no staged repair-to-forecast run exists | partial | Resolve a repair with used parts and verify stock, transaction, and forecast downstream |

### 19.3 P1 — season operations a funded team will abandon

| ID | Gap | Status |
|---|---|---|
| P1-1 | Event-day pages (My Day, schedule, rankings, pit) do not poll like command | partial |
| P1-2 | Briefing consumes cards / counter-book / defense / watchlist in code; live queue-side proof is absent | partial |
| P1-3 | Pick-clock POST/undo writes the canonical board; live concurrent draft proof is absent | partial |
| P1-4 | Attendance / roles member identity is implemented; live migration/writer proof remains | partial |
| P1-5 | Work and Task board share a canonical projection; legacy stores remain compatibility sources | merge |
| P1-6 | Playbook reading mode is implemented; engineering notebook image evidence remains open | partial |
| P1-7 | Safety incident delete not role-gated (audit; re-verify) | partial |
| P1-8 | Hours kiosk not barcode-first / not offline-queued | partial |
| P1-9 | Awards / grants lack copy-all / PDF export | partial |
| P1-10 | Outreach calendar does not complete into impact | partial |
| P1-11 | Vendor directory not referenced by orders | partial |
| P1-12 | CAD native workflow is implemented; live disposable-doc proof needs a user browser login (Onshape) and local add-in (Fusion) | setup-only |
| P1-13 | Bugbot file-cap, empty model context, no PR path | partial |
| P1-14 | Chat history-to-model; template features wearing AI badges | partial |
| P1-15 | AI function duration vs hosting plan cap | setup-only |
| P1-16 | TBA event-day refresh still cron-shaped | setup-only |
| P1-17 | In-place CSV on every table (export hub is undiscoverable) | partial |

### 19.4 P2 — finish, hide, or delete

| ID | Gap | Suggested status |
|---|---|---|
| P2-1 | Eleven scout-* meta tabs | hide from the Scouting tool strip (`inStrip: false`); routes, Cmd+K, and related links remain. Field value + Data quality stay on the strip. |
| P2-2 | Sponsor satellites (suite, ROI, tier, matching) | hide until they write CRM |
| P2-3 | Strategy satellites that do not write the pick list | hide or promote-only |
| P2-4 | `/award-tracker` vs `/team/awards` | merge |
| P2-5 | `/inspection` vs `/inspection-copilot` | merge |
| P2-6 | `/auto-routines` vs auton-path-library; `/incidents` vs heatmap | merge |
| P2-7 | `/mock-judging` vs judge-sim | merge |
| P2-8 | `/team/finance`, `/team/sponsors`, `/team/ai-hub` | merge |
| P2-9 | Media calendar without media bytes | partial |
| P2-10 | Pit map vs Nexus | hide / integrate |
| P2-11 | Decision-critic as “AI” | keep as rule scorer |
| P2-12 | Manifests unused at runtime | do not treat as coverage |
| P2-13 | Duplicate migration number prefixes ([GO_LIVE](../GO_LIVE_CHECKLIST.md)) | ops, not a feature row |

---

## 20. Change-log and PR checklist

This file is append-only in spirit: **edit the row, do not silently delete history**. Every PR that touches a product job updates this ledger in the same PR.

### 20.1 Per-PR checklist (required)

1. **Identify the row** (hub tab id + route, or standalone route).
2. **Update `Status`** using §2 tokens only. No `verified` from “page exists” or “empty state looks good”.
3. **Evidence:** add or replace the Evidence cell with a **relative file link** and/or test path, plus **ISO date** (`YYYY-MM-DD`). If tests were not run, write `not run`.
4. **DoD:** confirm §1.1 items that apply, or leave `partial` and name the missing hop.
5. **Changelog:** add a line under §20.3 (newest first).
6. **Stale docs:** if you fix something [FEATURE_COMPLETENESS_AUDIT](FEATURE_COMPLETENESS_AUDIT.md) or [COMMUNITY_DEMAND_RND](COMMUNITY_DEMAND_RND.md) still calls broken, add a correction row in §19.1 rather than rewriting those essays in place.

### 20.2 Status flip rules

| From → to | Extra requirement |
|---|---|
| anything → `verified` | Full §1.2 evidence pack + no open P0 on that job + not a live-service claim without a dated run |
| `broken` → `partial` | Repro no longer fails in current code; cite the file that changed |
| `unverified` → `partial` | Compute + API + honest empty/setup cited |
| → `merge` / `hide` / `remove` | Named surviving route; inbound links/redirects listed |
| → `setup-only` | Env var or pairing named |

Owners must not mark TBA, Onshape, Stripe, Resend, or production Postgres `verified` without a dated external run. `npm test` is necessary and insufficient.

### 20.3 Ledger changelog

| Date | Change | Evidence |
|---|---|---|
| 2026-09-10 | Hid eight scout meta jobs and the build-season Task board from hub tool strips without deleting routes. Scouting strip is Forms · Coverage · Shifts · Pit mesh · Training · Field value · Data quality. `/tasks` remains via Work's Open build board and Cmd+K. | [`hubs.ts`](../../apps/web/lib/nav/hubs.ts) `inStrip` + `hubStripTabs`; [`hubs.test.ts`](../../apps/web/lib/nav/hubs.test.ts); [`product-hub.tsx`](../../apps/web/components/product-hub.tsx). |
| 2026-08-31 | Completed the credential-free Team vertical slice: multi-channel chat lifecycle, supervised DMs/export/history, roster-linked attendance and role holders, owner/admin training mutations, canonical cross-tracker work view, exact knowledge object links, and a formatted Playbook reading mode. Added the missing channel archive migration. Kept rows `partial` where live Postgres, notification load, or downstream acceptance is not evidenced. | Team/canonical suite: 13 files / 189 tests passed; migration suite: 2 files / 15 tests passed; web typecheck and targeted lint passed. Key files: [`messages/channels.ts`](../../apps/web/lib/messages/channels.ts), migration `0498_message_channel_archive.sql`, [`attendance/route.ts`](../../apps/web/app/api/attendance/route.ts), [`roles/compute-roles.ts`](../../apps/web/lib/roles/compute-roles.ts), [`work-items/canonical.ts`](../../apps/web/lib/work-items/canonical.ts), [`knowledge-client.tsx`](../../apps/web/app/team/knowledge/knowledge-client.tsx). |
| 2026-08-31 | Finished credential-free CAD implementation evidence: browser-session Onshape auth, native editable sketch/extrude/Part Studio/assembly/instance/mate operations, CLI commands, session persistence, and CAD-to-purchase-request UI. Kept integration `setup-only`: `vantage-cad login --status` reports no saved browser session and the available live MCP credential returned 401, so no live geometry claim is made. | `@vantage/cad`: 20 files / 257 tests passed; `@vantage/cad-cli`: 6 files / 70 tests passed; both typechecks passed; CLI bundle/help smoke passed. |
| 2026-08-31 | Completed the credential-free competition vertical slice in code: chunked offline scouting, media preparation/linking, shared coverage, schema-role mapping, one pick-list board with Pick Clock writes, and briefing consumption of cards/counter-books/defense/watchlist. External event data remains an integration-release gate, not a fabricated `verified` claim. | Competition suite: 35 files / 393 tests passed; coverage adapter suite: 14 files / 130 tests passed; web + scouting + prediction-strategy typechecks passed. Mobile Edge route exercise returned valid honest states for `/competition`, `/scouting`, `/scouting/lineup`, `/scout-coverage-live`, `/strategy`, `/pick-clock`, and `/briefing`. |
| 2026-08-31 | Consolidated Lineup and Scout Coverage Live on one schedule/assignment/entry coverage compute while preserving the live surface’s threshold and nudge controls. | [`scouting/coverage.ts`](../../apps/web/lib/scouting/coverage.ts), [`scout-coverage-live/compute-scout-coverage-live.ts`](../../apps/web/lib/scout-coverage-live/compute-scout-coverage-live.ts); 14 files / 130 tests passed. |
| 2026-08-31 | Finished the shared domain spines in code: one pick list/board, finance mirrors, canonical work items and people links, unified parts consumption, evidence references, and briefing counter-book projection. Product rows remain `partial` until their end-to-end/live evidence packs exist. | Canonical model suite: 26 files / 280 tests passed; web typecheck passed. Key modules: [`picklist/store.ts`](../../apps/web/lib/picklist/store.ts), [`finance/source-mirrors.ts`](../../apps/web/lib/finance/source-mirrors.ts), [`work-items/canonical.ts`](../../apps/web/lib/work-items/canonical.ts), [`roles/holders.ts`](../../apps/web/lib/roles/holders.ts), [`parts/store.ts`](../../apps/web/lib/parts/store.ts), [`media/evidence-references.ts`](../../apps/web/lib/media/evidence-references.ts), [`briefing/counter-book-section.ts`](../../apps/web/lib/briefing/counter-book-section.ts). |
| 2026-08-31 | Made the four-app island’s full navigation path explicit with a fixed **All** button, added searchable navigation inside the drawer, and standardized page-header action placement/responsive wrapping. | [`app-shell.tsx`](../../apps/web/components/app-shell.tsx), [`page-header.tsx`](../../apps/web/components/ui/page-header.tsx), [`product-shell.spec.ts`](../../tests/browser/product-shell.spec.ts), [`page-header.test.ts`](../../apps/web/components/ui/page-header.test.ts). Mobile Edge smoke: `UI_SMOKE_OK`; shared UI tests: 61 passed; nav tests: 147 passed; web typecheck passed. |
| 2026-08-31 | Closed the lineup coverage 404 and added real assignment/swap/auto-assignment writes; kept the row `partial` because the older live-coverage route still uses a second compute and no event-day integration run exists. | [`api/scouting/coverage/route.ts`](../../apps/web/app/api/scouting/coverage/route.ts), [`lib/scouting/coverage.ts`](../../apps/web/lib/scouting/coverage.ts), [`coverage.test.ts`](../../apps/web/lib/scouting/coverage.test.ts). |
| 2026-08-31 | Initial conservative inventory. Hub tabs, logistics, admin, CAD, desktop, integrations. Stale-audit corrections for chunking, mapping, vault, recurrence, public sponsor wall, Bugbot retarget. **Zero rows `verified`.** | This file. Sources: [`hubs.ts`](../../apps/web/lib/nav/hubs.ts), [`product-nav.ts`](../../apps/web/lib/nav/product-nav.ts), [`command-search.ts`](../../apps/web/lib/nav/command-search.ts), [FEATURE_MAP](../FEATURE_MAP.md), [FEATURE_COMPLETENESS_AUDIT](FEATURE_COMPLETENESS_AUDIT.md), [GO_LIVE_CHECKLIST](../GO_LIVE_CHECKLIST.md). |
| 2026-08-31 | Corrected chat history, presence identity, and money-spine entries against current source. Historical tables are compatibility projections, not proof that canonical spines are absent. | [`messages/route.ts`](../../apps/web/app/api/messages/route.ts), migration `0478_presence_spine.sql`, migration `0461_money_unify.sql`, [`finance/ledger.ts`](../../apps/web/lib/finance/ledger.ts). |

---

## 21. Coverage summary (2026-08-31)

| Bucket | Count | How counted |
|---|---|---|
| Product hubs | 6 | competition, team, business, build, ai, media |
| Drawer pillars | 8 | Home + 6 hubs + Logistics ([`product-nav.ts`](../../apps/web/lib/nav/product-nav.ts)) |
| Hub tab ids | 199 | Every `tabs[]` entry in [`hubs.ts`](../../apps/web/lib/nav/hubs.ts) (shared routes like `/batteries` counted once per listing) |
| Competition tabs | 53 | Event day 8 + Scouting 16 + Strategy 25 + Pit 4 |
| Team tabs | 52 | Calendar 1 + Chat 1 + People 15 + Work 18 + Playbook 17 |
| Business tabs | 28 | Overview 1 + Money 7 + Sponsors 8 + Grants 3 + Outreach 9 |
| Build tabs | 44 | Kickoff 1 + CAD 4 + Code 6 + Robot 33 |
| AI tabs | 16 | Chat/Writer/Agent + Controls 8 + Notes 5 |
| Media tabs | 6 | Calendar, Drafts, Reminders, Kit, Media library, Impact |
| Logistics + packing/duties/visits | 4 | Pillar + deep links |
| Standalone / settings / public product | 50+ | §13–15 (dashboard through desktop-link, displays, claim/invite, exports, strategy/draft, bridges, …) |
| Admin routes | 13 | `/admin` + 12 children |
| CAD/desktop/editor extras | 8 | setup, connections, pair, review-queue, editor pair, CLI, Fusion, desktop |
| `app/**/page.tsx` | 294 | Next.js pages (includes marketing + admin + leaves) |
| `app/api/**/route.ts` | 412 | API modules (not all have a hub row; cron/webhooks live here) |
| Feature manifests | 124 | [`apps/web/lib/manifests/`](../../apps/web/lib/manifests) — metadata only |
| Workspace packages inventoried | 17 | §16 |
| Rows marked `verified` | **0** | Conservative initial fill |
| `broken` called in this ledger | 0 product jobs | Grant report now refuses unsafe attribution; live linkage remains `partial` |
| Stale-audit corrections | 10 | §19.1 |

**Intentionally not `verified`:** tenancy (strongest code, no live RLS proof), hours kiosk, briefing compute, alliance desk, BYOK save, Bugbot plan persistence, export CSV — all [GO_LIVE](../GO_LIVE_CHECKLIST.md) code-traces only.

If a route exists under `apps/web/app` and is missing from §§6–15, add it as `unverified` in the next PR; do not assume it is Done.