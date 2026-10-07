# Scouting evidence and shared UI review — October 7

Status: source changes and regression cases authored. Runtime, hosted acceptance and production release remain pending. This is not a declaration that the entire app is production ready.

## Intended behavior

- Required counts do not fabricate an observed zero when a scout leaves them untouched. This applies to older published number questions as well as season questions with `requireObservation`. A scout records zero explicitly or corrects the required answer before saving. Existing stored answers are not rewritten.
- A tap in a named counter records that counter alone. Untouched sibling counts remain absent; each has its own recorded/unknown state and an explicit zero/clear action. The whole block retains undo and clear-all. Positive minimums and maximums apply to the first tap and later taps.
- Entry rendering, save projection and server validation share conditional and inferred phase rules. A hidden required question cannot demand an unreachable answer. A stale hidden answer is removed by entry projection and rejected if submitted directly. Defense controllers remain reachable and inference does not invent undeclared controllers.
- Malformed persisted visibility rules cannot crash entry/validation or silently become unconditional. Publishing rejects malformed rules, missing controller questions and self references. Existing bad forms still need correction by their managers; this does not rewrite stored form definitions.
- Failed save validation keeps answers, presents all problems in the form and marks relevant questions. The match view opens Review before focusing a correction; errors do not follow a scout into the next robot. Activity-level errors use the summary. Question labels that share a prefix do not receive each other's messages. Device save, queue acknowledgement and access checks remain authoritative.
- If a device write finishes after the target, schema or answers change, its completion acknowledges the captured report without clearing or advancing the newer form. The newer draft stays open for a subsequent save; hosted acceptance must exercise delayed storage and edits/target changes during a save.
- Match scouting uses one border per question, quiet section headings, full-width field maps and named counters, and phase/correction controls at least 44 CSS pixels. This extends the earlier centered Forms editor and restrained navigation work.
- Trends show match observations only. Arbitrary valid custom choices stay in outcome frequencies. Climb attempts/capability do not become climb success. Explicit no-attempt outcomes are counted separately from failed climbs and missing observations; unfamiliar outcomes do not receive an inferred success rate.
- Each trend answer is checked against its report's own form before repeated reports are combined. Unknown observations do not outvote known ones. Numeric duplicates are averaged per robot-match; choice ties remain unanswered, and majority choices retain their original stored strings. Incompatible types/units/answer formats are not pooled; multi-choice lists and lap arrays are not presented as scalar metrics.
- Earlier/later qualification comparisons show answered/total robot-matches and contributing robots alongside the value. The contributing table is ordered by numeric qualification number. Coverage changes do not claim strategy changes or explain intent.
- Shared tables observe the currently mounted loading/empty/table/card wrapper, so an asynchronously loaded table can switch to phone cards and continue resizing. Horizontal tables are keyboard reachable; card selections have distinct names and long values wrap.
- Nested dialogs give keyboard control to the top dialog. Closing a confirmation preserves the parent's scroll lock and focus; the final close restores the page's prior scroll setting. Focus skips disabled/hidden controls. Descriptions are associated with dialogs; close controls are at least 44 CSS pixels. Existing 150ms exits and reduced-motion behavior remain.

## Design acceptance specification

The quality bar is a calm, useful workspace with a consistent visual hierarchy, not a claim of certification by another brand.

| Surface | Intended standard | Required hosted proof |
| --- | --- | --- |
| Page header | One clear title, short task-oriented description, primary actions visible and secondary actions disclosed | Recognize the next action without opening several menus; no duplicate headings in embedded hubs |
| Home | Existing personalized boards retained; new/reset boards start with tasks, calendar and real scouting coverage | New team is calm; populated team shows actual work; stale/denied data is identifiable |
| Navigation | Restrained translucent shell, grouped role-appropriate destinations, current section visible | Search, keyboard, focus return, clear/solid preference, short-height screens and closing animation |
| Forms | Centered document, discrete question cards, distinct draft/live state, predictable publication | Pit and match publication, edits, republishing, stable field keys, live readback and lead permissions |
| Collection | Robot/match context stays clear; large tap targets; explicit unknown/zero; recoverable correction | Complete match and pit capture on phones, switch phases, undo, change target, save offline and reconnect |
| Analysis | Real records, clear units and denominators, restrained charts, evidence available on demand | Validate actual outcomes against contributing reports, duplicate/conflicting/missing observations and different form versions |
| Tables/dialogs | Phone layout, long-name wrapping, keyboard access, subtle exits and predictable nested focus | Async load, repeated resize, selection, keyboard scroll, stacked confirmation, focus return and reduced motion |
| Empty/error states | Explain the missing prerequisite or recovery step without pretending there is data | Fresh team, expired session, lost permission, provider unavailable and network/storage failure |

Use existing semantic theme tokens, system typography, modest radii and one restrained accent. Content stays legible; navigation material obeys transparency and motion preferences. No simulated metrics or decorative widgets are evidence of feature completion.

## Verification performed and pending

Source review and Git whitespace checks only. No local database, tests, build, development server, browser runner, GitHub Actions job or Vercel deployment was started. Regression sources for observation projection, conditional validation, custom outcomes, deduplication, period coverage, question errors and counter semantics were authored/updated but **not executed**. Shared table and dialog interactions need hosted browser acceptance; code inspection alone is not runtime evidence.

The change intentionally makes required count questions stricter: an older form that relied on fabricated zeroes now asks for an explicit answer. Existing published schemas and historical data are preserved. Candidate client and server must be verified together, including offline clients reconnecting after an update.

Production gates remain: the missing 0710–0713 migrations, an authorized remote environment, actual verified free hosting allowance, deployed app/provider access and complete multi-user acceptance. PostgreSQL remains primary; Google Sheets primary storage is not migrated and needs a private authorized destination plus replacement auth/tenant/domain persistence and hosted readback proof. Do not bypass the schema gate, enable Actions, merge incompatible code or redeploy repeatedly to substitute for those checks.
