# Vantage — 50 Differentiating Features Sourced from Chief Delphi Complaints

Method: audited the codebase (96 pages, 146+ API routes, 12 packages) to see what's already built, then mined Chief Delphi threads (Reddit's r/FRC blocks scraping, so CD is the evidence base) for real, quoted complaints. Every feature below ties to a sourced pain point. Where Vantage already has partial infrastructure, that's noted — those are cheap wins. Net-new builds are marked as such.

Legend: **[GAP]** = nothing like this exists in Vantage today. **[EXTEND]** = builds on an existing fully-built feature. **[FIX]** = repairs something already half-built but broken.

---

## A. Scouting data trust & quality (the single biggest complaint cluster)

The best-evidenced pain in all of FRC: teams believe their scouting data is good and it isn't. One validator (BrennanB, CD) found ~15%+ climb-call error and 19.4% average error vs. match score across elite teams — "you may as well have a random number generator." A second finding: **more fields = worse data**, the best-performing team in his study had only 17 columns.

1. **Live cross-validation against TBA/Statbotics as data enters** [EXTEND] — Vantage already has the reference cache (`packages/reference`). Flag a scout's climb/mobility/foul entry the moment it contradicts the official match result, before the disagreement calcifies into your picklist. Nobody else does this in real time.
2. **Per-field confidence scoring surfaced to the scout, not just the analyst** — show scouts "this field has an 18% historical disagreement rate across your team" so they slow down on it.
3. **Automatic field-count budget enforcement** — warn org admins when a schema exceeds ~20-25 fields, citing the CD finding that field count inversely correlates with accuracy. Vantage's `scout_schemas` versioning already supports this; just needs a linter.
4. **Scout name identity lock** — CD found teams' data corrupted by scouts typing "Chloe," "Chleo," "Cho3" inconsistently. Vantage has real accounts (`memberships`) — force schema entries to bind to the authenticated member ID, never free-text name.
5. **Coverage-gap live dashboard** — show which robots are double-scouted this match vs. unscouted, in real time during quals (CD teams reported 14-30% coverage loss from this exact failure).
6. **Disagreement resolution workflow with audit trail** [EXTEND] — `scout_disagreements` exists; add a lightweight "which scout was right" reconciliation UI so disputes get resolved instead of silently averaged away.
7. **Post-match video re-scouting mode** — CD's highest-praise emerging workflow (multiple teams independently converged on it): pause/rewind video, 2x playback, assign 3-4 teams per scout instead of live single-robot coverage. Vantage already has `video-review.ts`/YouTube ingestion — wire scoring entry directly into the video player timeline.
7b. **Human-marks/machine-counts hybrid assist** — the two 2026 CD teams that tried full AI scouting both concluded robot re-identification (object permanence) fails, but "human traces the robot, ML counts game pieces in that region" works. Ship the assisted-counting half, skip the doomed full-autonomy approach.
8. **"Why is nobody covering this row" nudges** — push a notification to the scout coordinator mid-event, not a post-mortem stat.

## B. Offline & event-WiFi resilience (second biggest cluster)

CD, June 2026: "Why is not having wi-fi the worst thing to ever exist (probably)?" Every existing workaround (QR, hardware routers, upload-later) has a named failure mode in that thread. Your own codebase audit found the service worker deliberately refuses to cache page navigations — a cold offline load currently just fails.

9. **[GAP] QR code generation + camera scan for scout handoff** — Vantage's `importScoutData({format:"qr"})` only base64-decodes a string typed by hand; there's no QR generation or camera scanning anywhere in the repo. This is the most requested and most broken piece of scouting infra industry-wide. Build it on top of the existing device-pairing short-code pattern (`cad_pairing_codes`) you already solved for CAD.
10. **True offline app shell** [FIX] — extend the offline-first IndexedDB outbox (already built for scouting) to cache the navigation shell too, so a scout's phone works from a cold, no-signal load, not just after first load.
11. **Local peer-to-peer sync (no event WiFi, no server)** — device-to-device Bluetooth/local-network sync between scout tablets so data merges before anyone gets signal. Directly answers "we want data instantly" from the CD thread.
12. **Graceful TBA/API-outage mode, built-in not bolted-on** [EXTEND] — CD: "the API went down multiple weekends and threw a huge monkey wrench." Vantage's reference cache already has ETag/health tracking — surface an explicit "data source degraded" banner and let strategy tools keep working off last-good cache instead of failing silently.
13. **Cross-device format tolerance** — one CD quote: scouts use Chromebooks, Macs, Windows, and phones interchangeably. Any transfer mechanism (QR, sync, offline shell) must be tested across all four, not just the primary dev target.

## C. Scout engagement & motivation

Katie_UPS's canonical CD thread (345 likes) is the industry's most-cited scouting post: scouts treat scouting like a hazing ritual because they never see their data used, and gimmicky point systems don't fix quality even when they fix turnout.

14. **"Where your data went" feedback loop** — after alliance selection, show every scout which of their entries directly informed a pick. Directly answers "they have no idea if it's being used."
15. **Scout leaderboard tied to accuracy, not just volume** — reward being right (vs. TBA ground truth), not just filling out forms, to avoid the CD-documented failure mode of gamification rewarding turnout over quality.
16. **Built-in strategy-meeting seat for top scouts** — a lightweight way to rotate scouts into the pick-desk conversation Vantage already has (`lib/strategy/pick-desk.ts`), addressing the "alienated from their product" complaint directly.
17. **Scout shift load balancer** — CD: small teams mathematically can't staff full coverage (14+ committed people needed, many teams don't have that many total). Auto-generate shift rotations that respect a configured roster size and flag under-coverage before it happens, not after.
18. **Fatigue-aware shift capping** — hard-limit consecutive matches per scout with a visible countdown, addressing "at what point do they completely burn out?"

## D. Interoperability & portability

The Purple Standard project spent significant effort trying to get teams to converge on a shared scouting data format and stalled — teams don't want to migrate schemas, they want a tool that ingests theirs.

19. **Universal scouting-data importer** (CSV/JSON from other popular apps: FRC Scouting, Scout Radioactive, generic Google Sheets exports) — meet teams where they are instead of asking them to convert, which is exactly what killed The Purple Standard's adoption.
20. **Export in Purple-Standard-compatible schema** [EXTEND] — Vantage's `export-center` registry already streams 21 domains; add one more adapter targeting the community format so Vantage becomes the tool other teams' data flows *into*, not a third silo.
21. **One-click "start from last year's schema" carry-forward** — CD: teams rebuild their entire scouting app from scratch every single year, often because the person who built it graduated. Vantage's `scout_schemas` versioning already stores history — surface a "clone previous season, tweak for new game" flow front-and-center at kickoff.

## E. Alliance selection & pick strategy

22. **Low-scouting-data fallback picklist mode** — CD explicitly notes under-resourced teams need a "quick pick" style tool when they don't have a full scouting corps. Vantage's `rankPickCandidates` already supports tiers; add a reduced-input mode driven mostly by TBA/Statbotics for teams that can't staff full scouting.
23. **45-second pick-clock assistant** — CD: captains get 45 seconds to decide. A single-screen "next best pick + why" view (reusing `pick-desk.ts`'s reliability/foul-risk scoring) tuned for glanceability under time pressure, not a dashboard you have to read.
24. **EPA-drift callout** — Statbotics under-reacts to a team's recent improvement (CD's cited example: team jumped from EPA 60 to real-world 80-level play and the number lagged). Surface "this team's last-3-match trend diverges from their season EPA" so pickers don't trust a stale number.
25. **Per-field API-vs-scout trust toggle** — CD showed climb-call error is field-dependent (3% at one event, 20%+ at another) — there's no universal rule for "trust the API" vs. "trust your scouts." Let each org configure, per field, which source wins when they disagree, instead of hardcoding one philosophy.

## F. Institutional knowledge & continuity (root cause behind burnout, scouting churn, and inventory chaos)

CD, verbatim: "we only retain students for 2 years, so institutional knowledge walks out the door constantly" — and overwork is explicitly described as a *symptom* of that loss, not its own root cause.

26. ~~**[GAP] Team knowledge base / wiki with structured handoff templates**~~ — **shipped:** multi-page wiki at `/team/knowledge` (`knowledge_pages` + handoff templates) with FRC Assistant / CAD `knowledge.*` retrieval tools.
27. **Graduation exit-interview capture flow** — structured prompts for outgoing seniors/mentors ("what do you know that nobody else does?") feeding directly into #26, targeting the "Coach Steve is the catalog, and if he wins the lottery we're done" failure mode.
28. **Role-based onboarding checklists, auto-assigned by subteam** — ✅ `/start` Soft-UI path; tracks from team role + primary focus + calendar subteam name match; progress in `0163_role_onboarding`. CD: a new mentor with a 9-page onboarding doc still didn't know "whether to start on software, hardware, scouting, strategy, driving."
29. **Season postmortem generator** — auto-compile the season's decisions (`decision_records`), risks (`risk_register`), and incidents into a single "what we learned" doc at season end, so it survives graduation without anyone hand-writing it.
30. ~~**Cross-season searchable decision/design history** [EXTEND]~~ — **shipped:** wiki search spans `decision_records` + `design_reviews`; pages link to both; agents retrieve via `knowledge.search` / `knowledge.get_page`.

## G. Team ops: task management & workload distribution

The single most-liked statement across CD's burnout threads (46 likes): teams don't need more meeting hours, they need better management of the hours they have — and the concrete failure mode is 95% of the work concentrating on a few students while others idle at meetings with nothing to do.

31. **Live "who has nothing to do right now" board** — Vantage's task board (`lib/tasks/board.ts`) already tracks assignment; add a real-time view surfacing unassigned/idle members during a build meeting so leads can redistribute on the spot, not after the fact.
32. **Multi-assignee tasks** — CD: Asana's one-assignee-per-task limit was a named reason teams abandoned it, since FRC tasks are inherently collaborative. Confirm/extend Vantage's task model to support this natively.
33. **Meeting-time-vs-output tracker** — correlate logged build hours against tasks actually closed, to surface the CD-documented pattern where teams meet 47 hours/week but output stalls, without shaming anyone — just visibility.
34. **Norms benchmarking (opt-in, anonymized)** — CD mentors didn't realize their 47-hour week was abnormal until an outside thread told them. An opt-in, anonymized cross-team benchmark ("median team logs X build hours/week") would be a genuinely unique data asset only a multi-tenant platform like Vantage can offer.

## H. Inventory & parts (bus-factor problem, not a tooling-adoption problem)

CD is unusually blunt here: "tracking exactly how many of every component your team has in stock is almost certainly a losing battle," and spreadsheet lookups get abandoned ("the number of people who'll check a spreadsheet rounds to zero"). The real pain is findability and the fact that one adult holds the whole inventory in his head.

35. **Bin/location-first inventory, not quantity-first** [EXTEND] — Vantage's inventory+BOM (`lib/inventory.ts`) exists; reframe the primary UI around "where is X" with printable bin labels (QR or barcode) rather than stock-count accuracy, matching what CD says actually gets adopted.
36. **Phone-camera barcode/QR lookup for "do we have this part"** — scan a bin label, see contents instantly, addressing the literal "30 minutes looking through every box" complaint.
37. **Inventory knowledge capture from the one person who has it** — a guided "brain dump" flow (reusing #27's exit-interview pattern) targeted specifically at the team's de facto parts-hoarder before they graduate or quit.

## I. Attendance

CD shows 10+ independently built, abandoned DIY attendance tools (GrizzlyTime, FalconHours, RFID/RPi rigs, fingerprint scanners) — proof of unmet need *and* that shipping yet another tool isn't sufficient on its own.

38. **Simple tap-in kiosk mode** [EXTEND] — Vantage already has `/hours/kiosk`; make sure it's the "boring, reliable, no biometrics" option, since CD flags fingerprint/iris scanning of minors as a real legal-exposure risk several teams are unknowingly taking on.
39. **Student-visible hours (no adult intermediary)** — CD: one team's drawback was students "can't see their times whenever they want" and someone had to print and post them on a door. Give students their own live view.
40. **Attendance legal-compliance guardrail** — explicitly avoid/flag biometric data collection for minors in the product itself, turning a real legal risk other teams are running into a stated non-feature.

## J. Robot reliability & failure history

Team 4607's FMEA thread on CD (failures scored by occurrence/severity/detection, 5-whys in the pit) reduced repeat issues — but the promised template was never actually shared when people asked, showing real unmet demand for a ready-made version of this.

41. ~~**[GAP] Structured failure/FMEA log**~~ — **shipped** as `/fmea` + `fmea_failures` (O×S×D RPN, root cause, 5-whys, fix; optional links to `robot_subsystems` / `inspection_items`).
42. **Repeat-failure pattern detection** — surface "this subsystem has failed 4 times this season" automatically instead of relying on someone remembering across events.
43. **Digital pre-match checklist with timing** [EXTEND] — Vantage has `match-checklist`; CD explicitly values *not* relying on memory under pressure — make sure it's fast enough to actually replace the "15-20 minute paper checklist."

## K. Sponsorship & fundraising

CD, 2013 thread, still unanswered as of a 2017 bump: "we are in the same boat and looking for a simple CRM tool" for sponsorship pipeline tracking — and Salesforce's free nonprofit tier is gated behind 501(c)(3) status most school-sponsored teams don't have.

44. **Purpose-built sponsor pipeline CRM** [EXTEND] — Vantage's sponsor tables (`sponsors`, `sponsor_interactions`, `sponsor_prospects`) already model this; the differentiator is packaging it as "the CRM FRC teams can actually get" since generic CRMs are gated behind nonprofit status they don't have.
45. **Fundraising-goal-vs-actual tracker with stage pipeline** — directly answers the CD ask: "track against what our fundraising goal is for the year," staged by sponsorship process step.
46. **Auto-generated thank-you/renewal reminders** — the same CD post specifically wanted "sending thank yous... etc." tracked; a scheduled nudge when a sponsor interaction is overdue for follow-up closes that loop.

## L. Fix what's already broken or half-built

47. ~~**[FIX] Safety incident log**~~ — **already shipped.** This report's first-pass audit flagged `incident_reports` as an orphaned table with no migration; re-checking directly against the repo during verification found migration `0121_incident_reports.sql` plus a working `/incidents` page and API route already in place — built in a concurrent session while this research was running. No action needed here; leaving the note as a reminder to always re-verify "gap" claims against the live repo before acting on them, since this codebase is edited by multiple sessions at once.
48. ~~**[FIX] Reconcile the two parallel battery tracking schemas**~~ — **shipped.** Canonical model is `battery_packs` / `battery_logs` (0048). Migration `0153_battery_canonical.sql` copies leftover `batteries` / `battery_readings` (0024) rows, drops the legacy tables, and retargets pit/display/dashboard + Soft-UI `/batteries` at the one fleet.
49. **Cross-domain version-control awareness (CAD ↔ electrical ↔ firmware)** — a CD researcher posted this exact problem the same week (July 2026): "a CAD change breaking electronics board fit without anyone noticing until integration." Vantage already owns the CAD agent, GitHub context, and design reviews — a lightweight cross-link ("this CAD checkpoint touches a subsystem with an open design review") would be a genuinely novel integration nobody else in the space can build, since nobody else has both CAD and code context wired up.
50. **Subteam communication bridge inside Vantage chat** [EXTEND] — CD repeatedly shows teams fragmenting across Slack/Discord/Remind and thrashing between them. Vantage's team chat already exists; the differentiator isn't "another chat app," it's tying messages to the object they're about (a task, a CAD checkpoint, an inventory item) so teams stop needing a second tool to know *why* a message was sent.

---

## Where to start (if you want a short list instead of 50)

Highest leverage-to-effort, ranked by how directly they're sourced and how much existing Vantage infrastructure they reuse:

- **#9** (QR handoff) — the most universally cited scouting infra gap, and you already solved device-pairing for CAD.
- **#1/#12** (live TBA cross-validation + graceful outage mode) — your reference-cache is the deepest infra in the repo; this is the cheapest way to turn it into a user-facing trust feature.
- **#26** (knowledge base) — wide-open category, zero competition has built this well, and it's the root cause behind three other complaint clusters (burnout, scouting churn, inventory bus-factor).
- **#41** (FMEA failure log) — CD shows explicit unmet demand (people asked for the template and never got it).

Every item above is traceable to a quoted Chief Delphi thread found during research; sources available on request if you want them attached per-feature.
