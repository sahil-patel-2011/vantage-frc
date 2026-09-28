# Device settings and scheduled signup — September 27, 2026

This increment follows the user's latest launch decision. It does not certify the outstanding production gates in STATUS.md.

## Launch decision

Public signup cannot open before **December 1, 2026, midnight America/New_York** (`2026-12-01T05:00:00.000Z`). Both the operator's open switch and production-verification switch remain required. Existing sign-in and authorized invitations continue independently. Only the existing isolated, loopback test-database exception bypasses the calendar; invalid clocks remain closed.

Marketing and sign-in offer an early-access email to vantagefrc@gmail.com with team details in the draft. No email is sent automatically. The homepage and header read the live authentication gate; a cached marketing build cannot open signup. The homepage's primary action changes to account creation after the server gate opens. The administrator's checklist includes the launch date.

## Device storage and navigation

- Account → Appearance has a device-wide 2–20 GB cache budget, with a scrolling number selector, range input, keyboard arrows/Home/End, visible selection and immediate persistence. The default is 2 GB. This is a browser preference, not a team setting.
- Actual origin usage and browser quota are displayed when available. Browser quota remains authoritative; the app cannot reserve 2 GB or promise that 20 GB is available. Quota checks leave 10% browser headroom when the browser supplies an allowance.
- New document downloads, scouting event caches and product read snapshots check the budget. Estimates are approximate and concurrent browser writes can race; this is a best-effort budget, not a partition or disk allocation. Browser-managed application shell assets are not pruned by this setting.
- Lowering the budget does not delete saved data. New caching pauses while the origin is over budget. Unsent scouting, quarantined reports and other durable outboxes bypass read-cache limits. Existing acknowledged-upload removal remains in place; failed and unacknowledged writes remain queued.
- Reaching the budget must not turn a successful online fetch into a failed or stale page. Collection explains that the offline copy could not update. The event-pack preparation action reports cache failure, including completed phases.
- Layout responds to viewport and pointer capabilities. Touch controls remain at least 48 CSS pixels. The member hamburger folds match-day shortcuts under one disclosure; workspace destinations and search remain intact.

## Additional scouting evidence

Reviewed Lovat's public collection actions and dashboard breakdown-detail implementation again. GitHub reported no detected license for either repository; no source was copied. Reference behaviors are documented in SCOUTING-REVIEW.md.

Lap-mode timers now expose total seconds, recorded lap count and average lap duration. Each report is summarized, reports are combined within a match, then matches receive equal weight. Empty lap arrays explicitly record zero laps and total time; their average duration is unknown. Missing/malformed arrays remain missing. Original payloads are unchanged for raw inspection, export and recovery. This does not extend the network sharing projection to timer arrays.

## Verification record

See evidence/device-and-launch.json for the executed checks. Initial runs exposed noncanonical CSS tokens and the scouting component's 1,000-line limit; both were fixed. Local development loading timeouts and the initial CI server-readiness failure remain recorded. The final production-build replay passed eleven affected journeys plus two administrator launch-gate checks with unchanged assertions.

Full CI [36328963807](https://github.com/sahil-patel-2011/vantage-frc/actions/runs/36328963807) on `0063d23a141b5dc89c6f477612c58eaf47290faa` passed lint, all workspace types, 1,502 unit files / 11,209 tests, migration checks, isolated PostgreSQL/RLS and the 748-page build. All eight browser shards prove exact coverage of 414 planned cases: 408 passed directly, one passed on retry, five were explicitly skipped, and none failed finally. The unit suite retains 16 skipped files / 41 skipped tests; conditional database checks ran separately.

The retry was Lineup coverage. Its trace records a 34.57-second development-server document response; the 45-second test ended while coverage requests were still pending. The unchanged production-build test passed twice without retries (2.5 and 2.2 seconds). This is a bounded replay, not a claim that the CI timing issue is fixed. Phone, desktop and explicit dark/reduced-motion storage-panel accessibility scans reported no violations.

The fresh read-only production preflight is in evidence/production-preflight-device-launch.json. It still rejects the application's database privileges and missing dedicated runtime connections, recovery/export/MFA settings, cron secret, rate-limit configuration and public site origin. Protected Gmail SMTP settings are recognized as an available provider configuration, but actual delivery remains unverified. Four focused preflight tests and lint pass after correcting the earlier Resend-only requirement. No production settings were changed.

No claim of Apple/Google/Microsoft certification, universal feature parity, or a 90–100% usability score is made. Main merge, live Vercel deployment and opening public signup still require all release gates, including database roles, platform credentials, complete recovery/load proof and live integration journeys.
