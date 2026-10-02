# Team join codes and scouting interaction review — 2026-10-02

Teams can choose a six-digit join code during creation, including leading zeroes. Leaving it blank generates a random code. Existing teams can generate their first code under People. Administrators and people with delegated invitation access can view, copy, change, or turn off the code.

The public `/join-team` page asks for the team number, code, and email. A valid code creates a short-lived exact-email member invitation, then reuses the existing verified-email, profile, account-age, consent, and invitation-acceptance flow. Self-described mentor or lead roles do not grant administrator access. The founder can invite an administrator and hand over ownership while lowering their own access.

## Security and persistence

- PostgreSQL migration `0708_team_join_codes.sql` stores a bcrypt verifier and an authenticated encrypted copy for managers. It was applied to the verified production database before deployment; request-role execution and private attempt counters were checked.
- Join invitations expire after 30 minutes. Database-backed limits persist across app instances: eight attempts per email and 120 per network per 15 minutes; five wrong attempts lock that network/team pair for the window.
- Rotation and disabling revoke pending code-based invitations. Accepted memberships and ordinary email invitations remain intact. Saving the same code is rejected; random rotation avoids repeating the current code.
- Secrets are not returned to members or stored in the cached People snapshot. Code responses use private/no-store caching. Audit records omit the code.

## GUI findings and changes

The first phone walkthrough showed app navigation on the public join screen. It now uses the focused invitation-style shell, with no product navigation, tour, or analytics-consent prompt interrupting entry. Inputs retain their values after a failed attempt, and copying reports success only after the clipboard write succeeds. Canceling a code edit discards that draft.

Pit drivetrain answers now use large tap choices with up to three columns, keyboard radio navigation, and an explicit unknown state by clearing a selection. This retains the existing schema values, saved reports, offline queue, and analysis pipeline.

## Lovat source review

Downloaded `HighlanderRobotics/lovat` at `87900dc72086fed346ec3791006e916581490faf` into a temporary review checkout. Reviewed the collection game screen, pre-match position controls, game action controls, and raw-report analysis screen. The useful patterns are fast phase-aware collection, large directly selected answers, deliberate restart behavior, and drill-down from match/team summaries to source reports.

No root license granting reuse was found; the license under the dashboard's chips-input dependency applies to that dependency. No Lovat implementation or assets were copied into Vantage. The reviewed interaction patterns are implemented independently on Vantage's existing configurable forms, offline persistence, response tables/charts, and prediction systems. See the preceding [Home/forms and HIG release](scouting-hig-2026-10-02.md) and [Apple HIG web applicability review](../design/apple-hig-web-review.md).

## Verification

- Final production build: compiled, TypeScript passed, 753 routes generated.
- Regression suite: 58 files, 485 tests passed, five conditional tests skipped. Join-code and ownership-handover PostgreSQL tests ran against the isolated database.
- Production-build browser checks: eight Home editor/reset, offline scouting, navigation and form-response flows; two founder/admin/handover flows; one public-entry flow covering phone/desktop in light/dark mode. All passed.
- Development browser checks with real Better Auth and the isolated local mailbox: two full code-signup flows and one ordinary email-invitation signup. All passed. Tested wrong attempts, clipboard copy, profile/consent gates, member-only permissions, rotation, revocation, disable confirmation/cancellation, and accepted-member retention.
- Axe: no violations on the join screen in either theme/size or the code-manager panel. Touch targets and horizontal overflow checked.
- Changed TypeScript/React source lint passed. Tests use real sessions; the local API transport helper only normalizes an already-minted Secure cookie for loopback HTTP.
- Full GitHub unit execution found three test regressions: the claim fixture did not model join-code management/encryption, and the overlay census treated the public join screen as a workspace. Those fixtures were corrected; all 15 affected tests passed, with an additional check for generated and chosen encrypted codes.

[Phone entry](screenshots/team-join-phone.png) · [Desktop entry](screenshots/team-join-desktop.png)

These checks cover the listed journeys, not every button on every legacy page. Earlier full GitHub browser shards failed on broader legacy expectations/configuration; this report does not claim full-suite CI success. Production outbound email was not sent as part of the isolated signup tests. No fabricated prediction-accuracy claim was introduced.

## Production verification

The Git-triggered production deployment for `64760f82549219083612a84c8ac9d44af9e7f48a` reached READY with the canonical `vantagefrc.vercel.app` alias. Direct HTTP checks returned 200 for `/join-team` with the new page and for `/api/health` with `database: ok`. The live Chrome GUI recheck was blocked by `ERR_PROXY_CONNECTION_FAILED`; its cached offline fallback does not establish a deployment cache defect. The screenshots and interaction checks above are from the controlled local application builds.
