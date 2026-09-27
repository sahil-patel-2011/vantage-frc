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

See evidence/device-and-launch.json for the final executed checks. Initial runs exposed noncanonical CSS tokens and the scouting component's 1,000-line limit; both were fixed. A local development browser run timed out on two loading states during compilation. Those failures are retained in this record and require a production-build replay, not weakened assertions.

No claim of Apple/Google/Microsoft certification, universal feature parity, or a 90–100% usability score is made. Main merge, live Vercel deployment and opening public signup still require all release gates, including database roles, platform credentials, complete recovery/load proof and live integration journeys.
