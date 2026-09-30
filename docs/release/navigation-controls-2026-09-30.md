# Navigation and reliable controls — September 30, 2026

## Scope and inspected revisions

This release extends PR #2338 (`565a0e5ff`) from main `f0ba29d40`, which was also the successful production deployment when work began. The cloud checkout was clean before changes; the Windows checkout was not accessed. The existing PR's quality check failed because the source key guard parsed an arrow in an attribute before `key`; placing the existing key first fixes the guard without weakening its assertions.

The audit covered Home, Competition, Team, Build, Business, free scouting, AI, Account, onboarding and marketing. It preserves `DashboardHomeView`, saved boards, real APIs, permission checks, existing routes and signup eligibility. Media remains intentionally paused. Public signup remains closed: platform-provisioned owners and exact-email invitees have access; other visitors can join the waitlist. Marketing's existing copy describes these requirements, offline scouting, provider setup and current feature availability.

## Implemented behavior

- Desktop Search opens one centered navigation panel. The sidebar hides while it is open; phones use the hamburger and compact island. Escape restores focus even across the 1024-pixel breakpoint. The desktop rail reserves space before hydration, preventing overlapped content and duplicate initial navigation.
- Home has tighter spacing and aligned board/edit controls. The overdue Next match header now wraps within a 320-pixel phone when the countdown becomes “Running late.” Saved board management, sharing and editing remain available.
- Account uses one Help and support destination and compact team/role context. Team switching, administration and sign-out remain available.
- Work uses one selector for all six filters, title and Add together, and one completion action per task. Details contains status, assignment, dates, links and confirmed deletion. Failed server/device writes retain the draft and show actionable errors. Offline success waits for device storage; editing the next draft during a pending save no longer loses it.
- Form publishing finishes refreshing the published state before announcing success. The form-type controls visibly disable while publishing instead of silently ignoring clicks.
- Competition, Team, Build, Business and AI have a neutral, accessible loading surface while their tool bundles download. It has actual height, no animation and a labelled busy status.

## Cloud validation

Repository lint, workspace typechecks, **15 migration/static checks** and the production build passed. The full unit suite passed **11,244 tests**, with **42 existing skips** (1,508 files passed, 16 skipped). Required CI remains a separate gate on the final PR revision.

PostgreSQL 17 checks passed: three migration/reapplication/RLS integration tests, **40/40 non-superuser RLS proofs**, three invitation/inbox/onboarding integration tests and one scouting network isolation test. These used local scratch databases, not production. A controlled API journey provisioned a scratch team, sent an exact-email invitation, created a verified invited account through the development OTP mailbox, accepted the invitation and completed onboarding. The scout could not invite administrators; its persisted role was checked. Scratch journey resources were removed. Local delivery does not establish live SMTP delivery.

Browser suites passed for saved Home boards/editing/sharing, all task filters and real mutations, failed save/retry and offline-storage errors, pending draft preservation, free scouting/offline replay, form builder publication, team switching, notifications, account tools/sign-out, AI/Codex setup states, onboarding access walls and marketing accessibility. Layout checks cover 320, 390, 768, 1023, 1024, 1280 and 1440 pixels as applicable. Keyboard focus, navigation bounds, no-JavaScript desktop layout and a deliberately stalled tool bundle are regression-tested. Automated accessibility checks preserve their reports; they are not a usability certification.

The built runtime passed the 19 distinct auth, Home, Work, free-scouting and form-builder journeys. Four attached-run tests initially failed because the test process lacked its scratch `DATABASE_ADMIN_URL`; supplying the local URL resolved those fixture prerequisites. A stalled schema refresh now explicitly verifies disabled type controls, no premature published card, and restored controls after completion.

The [loaded-screen audit](evidence/cloud-interface-audit-2026-09-30.json) contains 30 checks at 1440, 768 and 320 pixels: all returned 200 with no page errors or horizontal overflow. An already-onboarded account correctly redirects onboarding to Home; incomplete-profile browser tests and the invited-account journey separately cover onboarding. [Desktop Home](evidence/cloud-home-desktop-2026-09-30.png) and [phone Home](evidence/cloud-home-phone-2026-09-30.png) show seeded scratch data, not production metrics.

## Release and limits

All required PR checks must pass before merge. Production should deploy once through the existing Vercel Git integration, followed by deployed-revision and public workflow verification. Live signed-in critical workflows, email delivery and personal provider connections require designated controlled production accounts and configured providers. Secure account requirements were saved to the cloud environment settings, with no secret values supplied. Local setup/error-state checks do not verify those live integrations. This evidence does not establish production readiness.
