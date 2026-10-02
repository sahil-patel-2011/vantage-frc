# Home and scouting release review — 2026-10-02

Home now uses the exact saved layout in both the editor and returned board. Refreshes preserve chosen cards and sizes. New stock boards contain six useful cards: next match, team tasks, scouting coverage, coming up, recent result and competition snapshot. Existing custom boards remain intact. Settings retains Reset Home.

Scouting defaults to Pit and the latest released game (REBUILT 2026), with older games available for offseason work. Robot number comes first; match identity appears only for Match reports. Published team forms also work without an event. Cancel sits beside Save, required missing numbers stay missing, and drafts recover through offline interruption.

The form workspace groups Questions, Preview and Responses. Questions support descriptions, required answers, options, reordering, duplication, removal and undo. Question menus contain secondary actions. Responses use actual records across published versions, with a readable table, configurable summary charts, team filtering and CSV export. Blank answers are distinct from recorded zeroes. All team members retain the existing collaborative form permissions.

Team switching and joining now live in Settings → Your teams. Settings are categorized by purpose. Scouting forms suppress the optional floating shortcut bar while entering answers, preserving the existing preference elsewhere.

Prediction scoring incorporates recent observed form alongside the existing EPA/scouting model. Strategy reports measured pre-match accuracy, log loss and Brier score by model version. No 98.2% accuracy claim is supported by the available validation data, and none is advertised. Hindsight predictions, unplayed scores and missing values are excluded.

## Design sources

The [Apple HIG web checklist](../design/apple-hig-web-review.md) records navigation, hierarchy, controls, defaults, accessibility, error recovery and the applicability of every supplied Apple reference. This is a web design review, not Apple certification. React, Next.js and PostgreSQL remain the architecture.

Reviewed [Lovat](https://lovat.app) and its [public source](https://github.com/HighlanderRobotics/lovat) for phase-specific scouting controls and observation/prediction presentation. Implementations are independent; no Lovat source or assets were copied. Game defaults were checked against the [FIRST archive](https://www.firstinspires.org/resources/library/frc/archived-games) and [2026 manual](https://firstfrc.blob.core.windows.net/frc2026/Manual/HTML/2026GameManual.htm).

## Verification

- Production build and TypeScript: passed; 750 static pages generated in the isolated release checkout.
- ESLint for changed source: passed.
- Focused regression suite: 136 files passed, 1,424 tests passed, 5 skipped. Includes media availability, dashboard drag/catalog, schema/response integrity, navigation and prediction tests.
- PostgreSQL team handover: passed. Verifies student founder access, untrusted mentor role descriptions, invitation acceptance, delegated invitation limits, ownership handover, self-demotion and last-admin protection.
- Combined browser run: 26 passed; one new assertion incorrectly assumed only admins could edit team forms. Corrected it to the existing member collaboration policy; its separate rerun passed. All 27 distinct workflows passed against the same final application build.
- Browser coverage includes phone/desktop board persistence, resizing, undo, save/reload, Reset Home, live task changes and failed writes; published form collection, cancellation, required answers, offline recovery, synchronization and identity isolation; builder reordering/duplicate/remove/undo/type drafts; response table/chart/CSV and schema history; onboarding shell, categorized settings, notification persistence and pre-match evaluation with team isolation.
- Accessibility checks: phone/desktop Home and forms, response tables in light/dark appearances, keyboard choices and scrollable table focus; no detected violations in the tested flows.
- Live review on `6224ae277` confirmed the saved Home/editor card set and game defaults, then caught a redundant form heading and oversized initial publish prompt. Removed the embedded duplicate heading and reduced publishing to a compact row. Rebuilt successfully, reran lint and all five builder/response workflows on phone/desktop; all passed. Evidence: `docs/release/scouting-hig-publish-polish-results/`.

Local evidence is retained under `docs/release/scouting-hig-ship-browser-results/` and `docs/release/scouting-hig-member-recheck/`; intermediate refined evidence is under `docs/release/scouting-hig-refined-browser-results/`. These trace/screenshot bundles are local, not committed.

## Release boundaries

The previous GitHub CI run on baseline `018d54d` failed in its browser shards before this release. Inspected failures include outdated tab selectors (Calendar) and missing background database configuration in the CI environment. Its migrations/RLS and lint/types/unit/build jobs passed. These are distinct from the local production-build workflow results above; do not report the entire repository CI as passing.

No exhaustive every-button certification is claimed. Media remains disabled through the existing shared switch; no database migration or native Apple integration is introduced. This release is pushed to the connected GitHub repository for Vercel's Git-triggered production deployment. Deployment completion must be checked against the exact resulting commit.
