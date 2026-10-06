# Vantage product interface specification

This specification applies to Home, Competition, Team, Build, Business, account settings and their nested tools. Keep the existing saved dashboard boards, PostgreSQL data, scoped APIs and offline scouting queues.

## Visual system

- Use the system sans-serif stack, neutral warm gray canvas, opaque readable content surfaces, subtle hairlines and restrained shadows. Glass belongs to navigation and dialogs; it must not reduce text contrast.
- One page title, a short purpose sentence where needed, one clear primary action. Group secondary controls by the user's task. Hide advanced configuration behind named disclosures.
- Use shared spacing, 12px control corners, 16–24px surface corners, at least 44px touch targets (48px on phones). Text wraps; data tables scroll inside a labelled region instead of widening the page.
- Light and dark appearances must both use semantic color tokens. Color supplements a written status; charts have an accessible description and show sample size.
- A form builder is a compact question outline with a focused editor, an explicit Expand all choice, a real scout preview and responses. Keep reorder, duplication, recoverable removal, immutable published field keys and independent match/pit drafts.
- Motion may move a dialog or fade its scrim color. Do not fade the text and input container. Respect reduced motion.

## Functional contracts

Every widget and tool must distinguish loading, empty, needs setup, saved data and a failed refresh. Never translate unavailable data into zero, a healthy status or an invented metric. A widget's number and destination must use the same team and event as the underlying records.

- Home: save and reload personal/team board layouts; tasks call the real task API; scouting coverage counts distinct scheduled robot/match slots, independently of duplicate reports.
- New user: exact-email invitation → actual email-code authentication → profile and policy acceptance → role-correct membership → useful Home. Test forbidden team access as well as the successful path.
- New team: profile → claim → starter forms → invitations → member access → ownership handover. A student can create their team and invite an adult lead. A failed save keeps their input.
- Scouting: edit and publish custom match/pit questions → select a real robot/match → record observed answers → persist → reload → responses and team analysis. Missing answers remain missing, zero remains an observation, and scoring formulas are explicit when questions collect actions rather than points.
- Offline: keep drafts and queued reports across navigation/reload; reconnect, persist and clear only acknowledged entries. Corrections replace the same scout's report and must not inflate coverage.
- Team operations: creating/editing/completing tasks, calendar events, stock adjustments and pick lists must change stored data and survive reload.
- External providers: absent credentials show actionable setup states. Local tests do not claim live email delivery, payments, CAD relays or provider refreshes. Media uploads remain disabled by the existing shared switch.

## Verification

For database-free presentation and client-interaction checks, use `npm run test:ui`. Its isolated Next server masks local and inherited credentials, disables database connections, and intercepts browser APIs. The regular census checks 31 primary and repaired destinations at 320, 390, 768 and 1440px in both appearances. `PRODUCT_UI_FULL=1` expands it to the registered non-media workspace destinations. This supplements the persisted workflow stories below; it cannot establish database or external-provider readiness.

Use `tests/browser/product-ui-audit.spec.ts` for the complete registered workspace presentation census. Set `PRODUCT_UI_AUDIT=1`, choose `PRODUCT_UI_WIDTH`, `PRODUCT_UI_DARK` and `PRODUCT_UI_OUT`; it records every route's status, page errors, overflow and WCAG findings, plus screenshots. This census is separate from functional browser stories that trace UI → API → PostgreSQL → rendered result.

Run fresh invitation and team lifecycle journeys, custom form publishing/response journeys, scouting online/offline journeys, dashboard board/task journeys and representative Team/Build/Business operations. Validate the shared UI at 320/390, 768 and 1440px, and dark appearance. Do not start a local database on the user’s laptop. Database-backed journeys require an explicitly authorized remote test environment; existing guarded fixture tests belong in the isolated test runner. Clean up only rows created by a journey.

## Audit record — 2026-10-06

Before the user stopped local database verification, the initial visual walk covered 23 primary surfaces and the WCAG census reached 54 registered routes. No horizontal page overflow or page JavaScript errors were found in those 54 routes. Five contrast findings affected export counts, form publish status, cross-check counts and pick-list badges; the corresponding styles were corrected. The full 235-route census was interrupted and is not certified complete.

Five functional browser journeys passed: real email-code invitation signup, member form access, custom form editing/publishing/preview/response persistence at 1280px and 390px, and desktop student/team creation with invited users and ownership handover. The phone team lifecycle run hit the authentication rate limit before setup; it is not reported as passed. Earlier baseline response journeys also collected real pit answers and displayed their numeric summary.

The local database and app/test processes were stopped at the user's request. Final unit, type, lint and build checks require no running database. Live external providers and the proposed fresh-team custom-match analysis simulation were not verified in this interrupted audit.

Final database-free checks passed: 11,358 unit tests (45 skipped), repository lint, all workspace type checks, and the optimized production build (753 static/dynamic routes generated). Browser verification of the final contrast corrections and unavailable-widget retry UI remains outstanding after the stop.

The subsequent database-free audit and reliability repairs are tracked in [UI readiness](../release/UI-READINESS-2026-10-06.md). It preserves the original full-census findings and records bounded replay evidence separately from the still-open production gates.
