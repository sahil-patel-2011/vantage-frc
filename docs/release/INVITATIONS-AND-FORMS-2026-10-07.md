# Invitations, navigation and form editing — candidate changes

Status: source changes only. This is not a production acceptance report.

## Intended experience

- A team admin enters one or several email addresses and chooses the existing team access level. New member and owner links last 24 hours; reissuing a link rotates the token and starts another 24-hour window. Existing links keep their recorded expiry.
- Both configured Resend and Gmail SMTP deliver invitations. A missing provider produces a manual-copy invitation, never a claim that an email was sent. The email names the team, recipient, access, expiry and account setup steps.
- The recipient opens the link, verifies the invited email through the existing Google or email-code flow, and completes the required profile/age and legal steps. Accounts without credentials can set a password of at least 12 characters and join. Existing credentials are kept. Google/email-code users may continue without adding a password. Each team's existing sign-in policy still decides which methods allow team access; password setup does not silently relax it.
- Password creation requires an authenticated, verified recipient and a live, matching invitation. Better Auth hashes the password and enforces its sensitive-session checks. The endpoint never writes a raw password or creates team membership. The separate invitation acceptance transaction remains responsible for age/legal eligibility, email matching, expiry, one-time acceptance and membership in the invitation's team.
- The menu has compact Home and Scouting destinations, grouped workspaces, the active workspace expanded, and separate account/team administration. Search, permission filtering and team context use the existing real navigation model. The drawer scrolls its destinations independently and closes with a short opacity/slide transition. Solid-material preferences, reduced motion and reduced transparency remain available.
- Form editing is a centered document: title/game card, visible Questions/Preview/Responses choices, individual question cards and explicit draft/live status. The selected question has a restrained accent edge. Preview uses the actual scouting field renderer; responses use real records.
- Successful publication immediately installs the acknowledged version and its stored field keys as the editor's baseline. Renaming a newly published question preserves its data key. Subsequent edits show the Publish controls again. A lost response does not claim success or encourage blindly publishing twice. Team changes invalidate old publication responses and hide the previous team's form.
- Optional offline snapshots load alongside the live request and cannot delay the live form. A successful publish does not depend on a second read or cache write. Closing/reloading an unpublished form warns about losing the tab's draft; this is not durable draft recovery.
- Shared product buttons, segmented views, inputs and icon buttons retain the existing system material and theme tokens with at least 44px control height.

## Source checks and unexecuted regression coverage

Reviewed Next.js client/route guides and the installed Better Auth account/password implementation. Source diff whitespace checks passed. No tests, lint, type checking, build, database, server, browser runner, cloud workflow or deployment was run.

Read-only inspection of the older hosted Home/menu confirmed that the menu's computed background was opaque white despite an active backdrop filter and no solid-material preference. The final shared surface selector had greater specificity than the material rule; the candidate separates those selectors so the later material rule can apply. The hosted search also showed two competing focus borders; the candidate keeps one visible ring around the search field. These are observations of the older release, not visual acceptance of the candidate.

The older hosted Team admin page loaded its member list and invitation form but reported "Email is off here" and offered "Create invite". That does not establish whether production has a usable mail provider. No invitation, email, credential or role mutation was performed during the inspection.

Added or extended unexecuted tests for:

- 24-hour invitation expiry and non-finite/overlong duration inputs.
- Gmail invitation delivery, failed delivery and accurate recipient/expiry email copy.
- Password setup: signed-out/unverified users, cross-site requests, short passwords, wrong recipients, used/revoked/expired links, existing credentials, provider failure and rate limits.
- Invalid invitation expiry, owner-link lifetime and Gmail delivery notices.
- Credential setup/acceptance remain reachable before team membership exists without opening unrelated API prefixes.

## Required hosted acceptance before release

1. In an authorized, isolated remote environment, invite a new person and an existing person into each of two teams. Use authorized test inboxes only. Confirm delivery and the exact team/access shown at every step.
2. For a new invitee, verify the email, complete the required profile and legal steps, set a password and join. Confirm membership belongs only to the intended team. Sign out/in with the methods that the team's policy permits. Repeat on a second device without automatic walkthrough or signed-in cookie popup.
3. Exercise expired, revoked, reissued, wrong-email and consumed links. Reissuing must invalidate the previous link. Check concurrent/double submissions and lost password/acceptance responses without credential replacement or duplicate membership.
4. Test team policies that allow and prohibit passwords. Google/email-code alternatives must remain clear and usable. Test a stale sensitive session and a failed email provider without reporting delivery or credential success.
5. Test a custom member-management role against owner/admin invitation rotation. It must not rotate a higher-privilege invitation it cannot create.
6. Walk through navigation with touch, keyboard and a screen reader at phone, tablet and desktop widths, in light/dark and solid/clear appearance. Check search, Escape, scrim close, focus return, scrolling, active links and role-filtered routes.
7. Publish pit and match forms, then rename/reorder/retype/add/remove questions and republish. Existing answers must keep their field identities; previews and response charts must reflect the saved schema. Repeat with denied access, slow/unavailable cache, broken network, season changes and team switches during requests.
8. Confirm every required question's validation, countdown/counter behavior, observation versus zero, offline saving/sync, scouting-lead permissions and meaningful trends using actual fixture records.

## Release gates still open

The latest production deployment is still ERROR; earlier investigation identified missing migrations 0710–0713. Do not bypass the schema gate. The app remains PostgreSQL-backed with Sheets copies, not Sheets primary storage. A private Google destination, a real auth/tenant/storage migration and deployed acceptance proof are still needed for the user's storage requirement.

AGENTS.md prohibits laptop tests/builds/servers/databases and disables Actions. A fresh remote testing authorization with verified free allowance is required for runtime checks. Vercel's actual remaining account allowance has not been verified, so no deployment is authorized under the cost policy yet. Keep these changes in the existing draft PR until compatibility and acceptance are proven.
