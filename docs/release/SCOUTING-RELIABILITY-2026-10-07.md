# Scouting reliability and intentional hosted work

Status: code changes reviewed; runtime verification and production release remain pending.
The broader [hosting and primary-storage release gates](HOSTING-DATA-READINESS-2026-10-06.md) still apply.

## Changes in this increment

- Practice uploads check revision and content inside the acknowledgement transaction. An older success or rejection cannot delete or mark a newer local edit.
- Upload drains join concurrent calls and use browser locks across tabs where supported. Empty queues make no network request. Each report POST still verifies its session account and team on the server.
- Validation failures remain on the device and require correction or an explicit retry. Authentication failures stop the remaining queue, which is preserved. Interrupted uploads remain retryable.
- Practice history has a dedicated refresh control, bounded requests, cancellation of superseded reads, and separate pending/attention counts. Optional device-cache failures do not prevent online history from loading. Unauthorized history is removed from the screen and its read cache is cleared where identity permits; unsent reports remain intact.
- Event scouting no longer lets a rejected optional cache read prevent the online bootstrap. Bootstrap/trust requests have cancellation and timeouts. Denied access removes the team's read cache and skips automatic uploads. Queue-read errors preserve the displayed state and explain the failure.
- Scouting form responses refresh on entry, return to the visible tab, or an explicit request. The former 15-second polling loop is removed. The header displays when the last successful response set was loaded. Form and team changes reset filters rather than applying a previous team's selection.
- An unconfirmed sharing mutation clears the toggle until the current server state is checked. Copy describes scouting-management access as well as owner/admin access.
- Optional hosted team provisioning, spreadsheet copies and recovery dispatch require `NEXT_PUBLIC_VANTAGE_HOSTED_BACKGROUND_ENABLED=1`. The example value is `0`; absent, blank and other values are disabled. This does not disable primary product saves or migrate storage.
- Team creation reports whether optional dispatch actually started. A committed core workspace remains usable if dispatch/bookkeeping fails. Older incomplete workspaces can finish their idempotent core defaults through an authorized owner/admin request while hosted background work is disabled. The setup screen explains that action and avoids endless polling/spinning for a job that will not start.

## Review and verification boundaries

Source review covered account/team scope, concurrent acknowledgements, cache rejection, request cancellation/timeouts, disabled dispatch, recoverable setup, loading/error copy, accessible status messages and wrapping action controls. `git diff --check` passed. No laptop runtime, local database, build, test runner, GitHub Actions run or deployment was started.

Regression cases were authored for empty queues, account/team separation, concurrent drains, edited reports during older acknowledgements, unconfirmed success, rejected sessions/answers, interrupted uploads, optional dispatch failure, and selective cache removal without losing pending reports. Existing enabled-dispatch cases explicitly opt in inside their mocks. These tests have **not been executed** and are not production evidence.

Hosted acceptance must still exercise the reviewed commit at phone/desktop widths, light/dark appearance and reduced motion, including actual offline save/reconnect, quota/storage failure, two accounts/two teams, lead grant/revoke, form publication and durable readback. Prior passing tests do not establish these new changes.

The deployed app still uses PostgreSQL as primary storage. Google Sheets primary persistence requires the private destination and deployable access, a complete persistence/auth/tenant replacement, preservation of existing data, and hosted acceptance. Missing production migrations 0710–0713, actual free hosting allowance and live cron shutdown also remain release gates. This increment must not be presented as complete production readiness or a verified comparison win over another scouting platform.
