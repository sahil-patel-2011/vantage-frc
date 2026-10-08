# Dashboard decluttering and reliability — October 7, 2026

Status: source changes prepared for review; production acceptance has not passed.

## Intended Home behavior

New and reset personal boards start with Team tasks, Calendar and Scouting coverage. Home keeps the existing saved board API and real loaders. Match-day data still feeds the daily brief even when Next match is not on the board. Existing layouts are preserved.

Quick actions are two compact controls: Add a task (or Team tasks for a viewer) and the role/event-appropriate scouting destination. Calendar and hours remain in the existing navigation and widget library. Greeting size, spacing and board heading are reduced; placeholder sales copy and repeated optional setup cues are removed.

Known empty or unconnected widgets collapse in normal Home. Unknown/loading states, failures and explicitly pinned widgets remain visible. Show quiet widgets reveals saved cards without changing the layout, scoped to the current account, team and board. Customize shows saved cards and offers Always show on Home / Hide when quiet. Resizing no longer silently pins a widget. Media-disabled widgets remain unavailable; stored layouts are preserved.

Getting-started checks default to a collapsed disclosure, with a bounded account/team-scoped read and mutation. Failed writes do not silently advance progress. These checks are separate from the once-only walkthrough. They cannot hold up widget data. Team setup has one compact next action rather than repeated setup cards.

## Reliability changes

- One Home request returns board and widget data; the immediate duplicate snapshot and periodic Home timer are removed. Explicit refresh, relevant actions, reconnect and a stale visibility return refresh data. Returning in under a minute does not request another snapshot.
- Requests have timeouts, cancellation and scope/sequence guards. Older board loads, snapshots and device-cache reads cannot replace a newer board response. A snapshot received after a task save takes precedence over older data in an overlapping Home response.
- Optional device-cache reads do not delay the live request; optional cache-write failures do not reject a successful server write. Widget freshness is retained separately from placement-save time. Partial refreshes do not declare the whole board freshly synced.
- Home reports failures with retry while preserving last-good data. Missing widget responses display unavailable, not fabricated setup requirements. Failed payloads cannot supply daily-brief instructions; a quiet brief is not displayed as an all-clear announcement.
- Dashboard membership/session failures have explicit 403/401 responses and private no-store headers. These failures clear painted board/data, disable editing and attempt to purge the device snapshot. A changed membership role similarly clears cached data for access revalidation. Cache reads require matching account and session role.
- Board save/share/switch/create/copy/rename/delete/reset requests prevent overlapping clicks, have timeouts and reject late responses after account/team changes. Saving an existing team board also updates its device copy. A drag from an old team cannot restore its layout over the new team.
- Inline and dialog task saves are bounded, guard duplicate clicks, abort on unmount and disable pending fields. Timeouts describe an unconfirmed outcome and direct the user to check tasks before creating another copy. Lost server acknowledgements still require hosted acceptance; no automatic retries are introduced.

## Evidence and pending acceptance

The hosted owner account's Home was inspected at its actual 668 × 664 viewport. It still shows the older release: four large action cards, a No event selected prompt and ten mostly empty widgets, including a second setup/event prompt. This confirms the baseline problem; it does not validate the changed CSS or logic.

Source review followed the default provisioning/layout, view filtering, Customize and pin controls, request/cache lifecycles, drag cancellation, board mutations and both task entry points. `git diff --check` passed. Regression sources cover quiet/pinned/unknown/failed widgets, shared setup, default layouts, always-loaded match data, failed daily-brief payloads, freshness preservation, 401/403 responses, cross-site mutation rejection, invalid IDs and oversized requests. **None were executed.** No test/type/lint runner, build, development server, local database, Actions job or deployment was started.

Required hosted checks for this increment:

1. Build/type/regression checks against the exact candidate in an authorized remote environment within verified free allowance.
2. Fresh team and existing board: empty/live/unavailable data, pinning, quiet-widget toggle, adding/resizing/reordering, Save/Cancel/Undo, reset and phone/desktop layouts in light/dark appearance.
3. Two accounts/two teams: team switch during board load, cache read, snapshot, board mutation, task save, onboarding-check save and active pointer/keyboard drag. Denial and role downgrade must clear private data and prevent stale success messages.
4. Slow/failing/blocked cache, offline/online return, timeouts, malformed responses, overlapping task save and Home refresh. Verify actual server rows after uncertain acknowledgements before retrying creation.
5. Compare request counts: one Home bootstrap, no idle timer, bounded action/visibility refresh. Check keyboard focus, touch targets and reduced motion on the deployed candidate.

Repository Actions permissions were rechecked as disabled. Vercel still reports the same latest production attempt as ERROR; prior schema-gate evidence identifies missing migrations 0710–0713. Account allowance, live cron settings and a compatible release remain unresolved. A private Google destination/app credentials and replacement account/session/tenant/domain persistence are still needed for Sheets-primary storage. PostgreSQL remains primary. Full-app acceptance and these external gates remain in [WALKTHROUGH-2026-10-07.md](WALKTHROUGH-2026-10-07.md). The draft must not be represented as production ready or superior to Lovat.
