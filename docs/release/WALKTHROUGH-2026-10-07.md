# Hosted walkthrough and remaining acceptance

Status: limited hosted walkthrough completed; new fixes await execution and deployment. Production readiness and Google Sheets primary storage remain open.

Use this handoff with [hosting/data policy](HOSTING-DATA-READINESS-2026-10-06.md) and [scouting reliability changes](SCOUTING-RELIABILITY-2026-10-07.md). Historical test results do not prove the current candidate.

## Observed through the hosted browser

The browser initially showed Sign in, then became authenticated during this pass. Checks used the existing owner account and existing team. No invitation, permission grant, form publication, report deletion, paid AI operation or explicit production-data mutation was submitted. Preview answers are explicitly unsaved. Calendar view was returned to its previous List setting.

| Surface | Observation | Remaining verification |
| --- | --- | --- |
| Sign in | Email/password/reset panels and team-code navigation open. A tokenless invitation offers recovery links. Dashboard redirects to Sign in before authentication. | Email delivery, password reset and failure responses were not submitted live. |
| Home | Personal board, widget empty/setup states and task/calendar/practice links render; missing event has a clear action. | Saved layout/widgets, populated totals and cross-team scope. |
| Scouting | No-event screen offers practice/event setup. Practice opens without an event; Start is disabled with a blank team. Existing uploaded report expands and shows recorded zeros. | New collection, queueing, upload, correction, deletion and active-event fixtures. |
| Forms | Season/type/title and six pit questions load. Questions/Preview/Responses switch. Preview changes missing → recorded zero → one → cleared/missing. Responses explains that publication is required. | Actual version publication, response persistence and lead/scout comparison. |
| Team comparison | Teams opens Our scouting/Team lookup and asks for an event before showing robot comparisons. | Populated comparison, event filtering, strategy/pick workflows and trends. |
| Team admin | Membership/invitation panels and existing access presets load. Apply is disabled without an eligible assignee. | Invitation delivery, two-account grant/revoke and cross-team isolation. The live release lacks the new Scouting lead preset. |
| Team | Calendar shows an existing event; Day opens the current date. Work shows a saved completed task and empty build-work counts. | RSVP, event/task mutations and durable readback. |
| Build | Kickoff and Code load. Empty scoring/priorities/rules have next actions; connected repository scan requires GitHub connection. | AI, connected scans, CAD, robot deployment and specialist integrations. |
| Business | Overview requests a season budget. Money shows funding/purchase empty states and labels records represented elsewhere to avoid double entry. | Budget, receipts, orders and other financial mutations. |
| Account | Profile/recovery-email controls and settings navigation load. No cookie banner or automatic walkthrough appeared during signed-in navigation. | Fresh account, second device, returning account and unavailable-storage behavior. |

Screenshots inspected at the actual **668 × 664** browser size showed consistent neutral surfaces, clear headings, restrained accents and readable controls on reviewed pages. Business's document width matched the viewport. A 390 × 844 override did not change the rendered size and was reset; **this is not a phone-width pass**. No page-error entries were captured by the browser console log API during this limited walkthrough. Dark appearance, other widths, reduced motion and keyboard-only operation remain pending.

The hosted release is older than the candidate. Fresh Vercel metadata still reports latest production attempt `dpl_2v9mABu1XUv4NiUxvTi8y7eCbWJY` as `ERROR`. Its previously inspected schema-gate logs report missing migrations 0710–0713. Live observations cannot verify unpublished roles, trends, tour or reliability fixes. Vercel's settings tab still shows Login; actual remaining free allowance and live cron shutdown remain unverified.

## Fixes from this review

- Reset advances only after the request endpoint accepts it. Rejections/rate limits no longer claim a code was sent. Copy consistently describes a code; update failures distinguish service/rate failures from invalid codes without exposing account/provider details.
- Password/Google sign-in distinguish rate limits and temporary service failure from bad credentials or closed signup.
- Password/reset controls reject incomplete inputs, prevent duplicate pending password requests and prevent panel changes during a request. Changing the reset address clears its old code state; entering reset clears the previous password. Sign-in, verification, invitation preview and onboarding reads have timeouts. A failed verification-status request after password sign-in does not proceed as if verification succeeded.
- Form publication validates bounded JSON before identity/budget readers or persistence. Invalid seasons/types, unsupported fields/widgets, malformed fields, duplicate/dangerous keys and empty/duplicate choice options are rejected. Existing presentation metadata is retained.
- Publication, event starter schemas and core team initialization share a transaction-scoped schema-version lock before reading/inserting versions. Organization UUID casing is normalized for lock identity. This is designed to serialize competing writes; actual database concurrency still needs acceptance.
- Leads can reach **Build scouting forms** from the no-event screen when server permissions allow it. Owners/admins get a direct **Custom roles** link on Team admin, including before they have teammates. Both preserve team scope and reuse existing destinations.

## Source review and evidence boundaries

Source review followed Home's actual `DashboardHomeView`/widget loaders, five-workspace navigation and redirects, form editor/API contracts, practice/event queues, trends, tour claims, signed-in consent suppression, custom-role application and scouting-management permissions. Team/Build embed existing clients; Business distinguishes live/cache/denied/setup states. The old mock dashboard remains unused.

Trends use scoped observations, deduplicate robot/match evidence, retain zero versus unknown, show coverage and avoid combining incompatible field units/types. Recorded no-climb outcomes must never imply a team's intentions. Roles depend on deployed permission objects; frontend buttons do not prove authorization.

The inventory has 327 page entry files and 507 API route files, including aliases and specialist/admin destinations. This pass does not establish execution of every page, button or API. Specialist integrations and durable mutations require appropriate fixtures and provider access.

Source inspection and `git diff --check` are the checks performed for this increment. New regression sources cover reset rejections and valid/malformed publication boundaries, including actual season starters. **No test, type/lint runner, build, local server/database, browser runner, Actions job or deployment was started.** Tests are unexecuted. Repository Actions permissions rechecked as `enabled: false`; both saved workflows remain `disabled_manually`.

## Acceptance order

UI completion standard: one clear page title and main task; neutral surfaces with restrained status/accent color; accessible labels and visible keyboard focus; touch targets that remain usable at phone widths; secondary tools grouped rather than duplicating the main task. Every widget must identify real data, scope and freshness or show an honest empty/setup/error state. Pending mutations need a busy state and durable success acknowledgement. Dismissals should animate subtly, restore focus and respect reduced motion. These are acceptance targets, not a claim that every specialist surface has passed.

1. Establish authorized private Google destination and deployable credentials. Replace PostgreSQL account/session/tenant/domain persistence through a defined storage interface; preserve existing data and prove migration content/counts/recovery before cutover. Current Sheets integration still produces copies.
2. Choose the compatible release/data path. Current SQL code needs migrations 0710–0713 in an authorized remote environment; a Sheets replacement needs equivalent access/concurrency guarantees. Keep the production schema gate. Verify required encryption/rate-limit configuration without copying secrets into evidence.
3. Verify actual remaining free hosting allowance, spend controls and live cron settings. Git builds/schedules stay disabled. Remote acceptance requires fresh authorization for a named environment; former Actions authorization is revoked. Never substitute the laptop.
4. Validate exact candidate types/build/regressions there, then exercise fresh user/team, invitation/team-code join, core setup with optional jobs disabled, reload/team switch, once-only tour and signed-in consent suppression.
5. With two accounts/two teams, grant/apply/revoke Scouting lead and custom roles. Verify form/data management and denial of unrelated admin/cross-team actions. Race first publication with starter creation and simultaneous publications; require unique increasing versions and preserved definitions.
6. Capture full match/pit reports: unknown/zero, climbs, activity intervals, required fields, correction, interruption, edit during older acknowledgement, reload/reconnect and durable primary-store readback. Rejections remain recoverable; empty queues make no upload request.
7. Seed complete/partial/conflicting event observations. Check trends/coverage, filtering, comparisons, strategy, shared picks and scout breakdown against actual source records. Exercise every visible mutation/return path across workspaces; check phone/desktop, light/dark, keyboard/touch, dismissal focus and reduced motion.
8. Once gates pass, merge the exact reviewed commit and make one intentional deployment within verified allowance. Smoke-check that deployed revision. Resolve schema/configuration failures before another deployment.

Lovat superiority/parity, perfect usability, capacity and zero-cost guarantees are not established.
