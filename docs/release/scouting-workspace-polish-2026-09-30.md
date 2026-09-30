# Scouting workspace and release verification — September 30, 2026

## Source and production baseline

Reviewed and fast-forwarded the primary checkout to `e945f1fd7e4f1a0c25f7270b00a30e1d1fdeb9f5`, including merged [PR #2338](https://github.com/sahil-patel-2011/vantage-frc/pull/2338). Its task-draft persistence, form-publication feedback, real loading states, reserved desktop rail, and narrow Home layout remain intact. Changes were made in the existing managed worktree; the user's `.claude/launch.json` and `.claude/web-localdb.mjs` remain untouched.

Before editing, the public aliases still served an older deployment even though the latest main deployment was ready. Vercel's `autoAssignCustomDomains` was disabled. Promoting the existing ready `dpl_FgRZupTKdKieE45cjQzjBAeQL862` restored all seven configured public aliases to the merged main revision without building again. Automatic domain assignment is now enabled. The new source revision must still pass GitHub checks before merging and its Git deployment must be verified by commit and alias, not merely by a ready deployment status.

## Implemented changes

- Robot profiles have one navigation group: Overview, Matches, Capabilities, Notes. Match history, original reports, custom-form metrics, positions, paths, private notes, sample counts, and real event/match/confidence filters remain available through the existing services.
- Four adjacent sort buttons become one labeled native select with the same four ordering modes. Event summary and field overview sit in a disclosure. Unscored robots retain a separate raw-observation explorer; lacking a scoring formula does not hide their capabilities.
- Phone/tablet robot selection opens one focused detail view. Back restores search, selection, scroll position, and keyboard focus. Desktop keeps the list and detail together. Comparison remains limited to the existing three robots and its saved state remains scoped to the person, team, and event.
- Robot-list and match-history errors provide real retry actions and recover on reconnect. Expired sessions offer sign-in; permission rejection does not become a retry loop. External match-video links remain available while uploads stay disabled.
- Restored the missing chart stylesheet import. Trend charts have a stroked line, subtle fill, readable axes and aligned phase samples instead of a solid black shape. Data remains visible with reduced motion. Removed decorative row/stroke entrance animations and moving press targets in this workspace.
- Sharing retains its visible status and authorized owner/admin toggle, with detail in “What is shared?” Past and new structured reports remain shared when enabled; identities, free text, private notes, and action history remain excluded.
- Fixed Personal Codex snapshot identity: a combined user/team cache key was being sent as an organization ID to `/api/me`, returning 400 and preventing saves. Snapshots now use the real organization ID and the existing verified personal-cache boundary. Connection status refreshes on offline/online transitions, clears rejected snapshots and keeps them blocked until live access succeeds, offers retry or renewed sign-in as appropriate, and disables pairing while offline or unavailable.
- Self-hosted the same six Latin font assets for the four existing families using `next/font/local`. This repairs a production-build failure caused by Google Fonts fetches without changing the type families or adding browser requests to Google. Original licenses, source URLs, weights, and hashes are included in `apps/web/assets/fonts`, outside the route directory.

`DashboardHomeView`, saved-board APIs, records, permissions, feature routes, specialist editor links and media preservation are unchanged. No fake metrics, successful integration stubs, or alternative Home implementation were introduced.

## Lovat reference and measurable boundaries

Reviewed [Lovat](https://lovat.app), its [public collection repository](https://github.com/HighlanderRobotics/lovat-collection), and [public dashboard repository](https://github.com/HighlanderRobotics/scouting_dashboard_app). Collection phases/contextual actions and detailed metric-to-match lookup informed the organization of existing Vantage observations. Implementation is independent; no third-party source or assets were copied.

| Behavior | Vantage implementation and evidence | Remaining comparison work |
| --- | --- | --- |
| Collection and recovery | Existing phases, custom forms, timestamped actions, autosave and outboxes; real no-event offline/reload/reconnect journeys | Timed field studies against Lovat, QRScout and ScoutRadioz |
| Detailed results | Profile sections expose existing original reports, units, missing/zero distinctions, disagreement evidence and match filters | User study on retrieval speed and comprehension |
| Ranking and comparison | Same real ranking model, persistent weights and three-team comparison; all four sort modes tested | Event-day decision quality and performance under competition load |
| Navigation effort | Sort controls reduced from four to one; robot detail has one section bar; phone Back restores context | This is a measured local control reduction, not a claimed 25% global reduction |
| Reliable failures | Real backend retries, reconnect recovery, sign-in guidance and private-cache checks | Provider/device outages in a full live operating cycle |

No empirical result establishes universal superiority over specialized software. Prior gaps in [SCOUTING-REVIEW.md](SCOUTING-REVIEW.md), including partner-specific grants, shared-schema mappings, camera/device transfer and load benchmarking, remain separate acceptance work.

Design references: [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Material foundations](https://m3.material.io/foundations/), [Fluent layout](https://fluent2.microsoft.design/layout), and [Fluent typography](https://fluent2.microsoft.design/typography). These guide restraint, hierarchy, and organization; automated accessibility is not vendor certification or a 90–100% usability score.

## Acceptance coverage

| Area | Evidence in this run | Scope limit |
| --- | --- | --- |
| Home/navigation | Saved Home controls, live destination links, prompt real data requests, keyboard tool selector, landscape bounds | Actual saved-board services retained |
| Competition/scouting | Real robot reports and ranking, four profile sections, phone focus/scroll return, retries, no-event collection, offline recovery, form publication | Explicit injected failure cases retry the real API; they do not establish live provider success |
| Team/access | Real phone/desktop team switching, scoped writes and role changes; new scratch team, invite, verified email-code signup, acceptance and scout Home | Team creation/profile completion partly use APIs; local OTP is not evidence of SMTP or Google provisioning |
| AI | Real personal status cache/reconnect/error journeys, personal-memory CRUD, PostgreSQL device/job/tool isolation and revocation checks | Actual execution on a personally paired Codex remains unverified |
| Account | Real notification acknowledgment/counts and authorization, account navigation and offline budget persistence/keyboard access | Live export/deletion/provider security flows remain separate acceptance work |
| Build/Business | Authenticated layout, accessibility and runtime audit at three widths; existing full CI regression suites required | This run's layout audit does not establish every transactional workflow |
| Marketing/onboarding | Real public links and access copy, phone menus, restricted signup and invitation-age checks | Public signup remains gated for December 1 and production acceptance; no opening is claimed |

The presentation audit covers ten entry points at 320, 768 and 1440 pixels: Home, Competition, Team, Build, Business, scouting, AI, account, onboarding and marketing. It checks horizontal overflow, duplicate menu controls, page errors, loading completion and WCAG A/AA violations, captures screenshots, and intentionally distinguishes rendering from functional workflow proof.

## Test record

- Repository lint and all workspace typechecks passed. Final changed web source is rechecked before commit.
- Full unit run: 1,508 files and 11,244 tests passed; 16 files / 42 tests retained their existing conditional skips. Database tests below ran separately rather than treating those skips as acceptance.
- Fresh UTF-8 scratch PostgreSQL: five migration/reapplication/onboarding-schema checks, 40 non-superuser RLS proofs, 19 invitation/inbox/onboarding/sharing/static-migration checks, and three personal bridge/tool tests passed.
- The initial database was created with a Windows encoding and failed a Unicode migration. Only the newly created release-test database was recreated with UTF-8, then all migrations and assertions reran. The existing browser-test database was preserved.
- Focused development browser run: 46/48 passed. The account journey exhausted the fixture config's 30-second default while navigating its fifth page; its unchanged assertions passed with the repository's normal 90-second local budget. The notification test assumed no preexisting fixture inbox rows; it now isolates unread state and restores exact prior timestamps. Both reruns passed.
- Expanded browser rerun: 25/25 passed, including real sharing/opt-out, sorting/weights, personal memory and phone/desktop profiles. The final font layout audit repeated all 30 entry-point/viewport combinations with no detected WCAG violations, overflow or page errors.
- Personal Codex cache/recovery and real retry regressions: 2/2 passed. The first cold development replay timed out compiling the status endpoint past its fetch deadline; the final regression warms and verifies the actual status API before asserting cache behavior. Production-build repetition is also required.
- The compiled local app passed 25/25 critical browser journeys. After visual review found the chart import defect, its rendering and reduced-motion assertions were added and the final build/profile checks rerun before commit.
- A repeated compiled run exposed a test interception race: the synthetic 403 could arrive during the simulated offline phase. Revocation now starts after the offline-copy assertion. The regression additionally checks that a known rejection removes its stored snapshot and cannot restore cached success offline.
- The first GitHub unit run caught two route-inventory failures caused by putting font assets inside `app/`. Assets moved outside routing; the inventory and overlay assertions remain unchanged.
- The original font-fetch build failure is retained locally; the self-hosted-font production build passed. Final GitHub quality, PostgreSQL and all browser shards are release gates. Their exact run/head and deployment outcome belong in the PR and handoff.

Local logs and preserved failure traces are under ignored `audit-artifacts/release-polish`. No assertions were removed or failures silently skipped. A longer local cleanup-hook budget was needed for the personal feature-tool test's scratch cascade cleanup; all permission and mutation assertions remained unchanged.

## Production configuration and remaining acceptance

The live SELECT-only probe confirmed the prior request connection used `neondb_owner` with `BYPASSRLS`. Existing request transactions explicitly select `vantage_app`, but the deployed login itself still had unnecessary owner privileges. Created fresh restricted logins for `vantage_app` and `vantage_pairing` and verified both connect without superuser/RLS bypass. The app login sees zero organizations without identity. The pairing login can execute bridge claim functions and cannot read inventory.

Configured Vercel production `DATABASE_URL`, `DATABASE_AI_BRIDGE_URL`, and `DATABASE_CAD_RELAY_URL` as sensitive values. No application records, schemas, migrations or stored media were changed by this configuration work. Credentials stay outside source and evidence. These settings activate on the next Git deployment; final live checks must confirm it.

Other protected production settings cannot be pulled by Vercel. Presence alone does not verify auth/worker credentials, SMTP, Google read-back/recovery, key services, rate limits, schedules or account export/deletion. The original full-launch/load/recovery requirements in [STATUS.md](STATUS.md) remain open until demonstrated. This scoped UI release must not be described as completion of the entire production plan or as a guarantee against future defects.
