# Runtime cost correction — 2026-10-02

## Observed production problem

Vercel's production runtime logs over the preceding 24 hours showed 1,440 recovery cron calls, 2,881 workflow flow calls and 8,640 workflow step calls. Error clusters contained 1,441 instances of `Google recovery is unavailable.` and 1,441 exhausted-retry errors. Failed recovery steps reached attempt 6, retry count 5.

The recovery cron started a durable workflow every minute without checking the Google connection or whether any events needed exporting. A missing connection then triggered the same step's automatic retries. The readable spreadsheet cron also treated absent setup as a service failure.

## Correction

- Check the operator secret and Google bridge before dispatching recovery or readable spreadsheet jobs. Invalid secrets skip database access as well as workflow dispatch.
- Check for pending recovery events before creating a workflow. An idle tick returns HTTP 200 without a run.
- Stop recovery's extra cycles when the exporter is current, busy, or no longer configured.
- Treat permanent recovery coverage and Google request/access failures as fatal step errors. Preserve provider-directed quota delays and retries for temporary failures.
- Keep events pending until content verification succeeds. Existing locks, acknowledgement rules, sync throttles and cron frequencies remain intact.
- Return HTTP 200 for an unconfigured or idle readable-sync cron, HTTP 202 for queued work and HTTP 503 for actual dispatch failures.

## Verification

- Six focused test files: 43 passed. Cases cover absent/invalid setup, pending/current recovery, successful readable dispatch, dispatch failures, authorization, early exit, verified exports, integrity failure, revoked access and quota delays.
- Targeted ESLint and whitespace checks passed.
- Isolated production build passed TypeScript and generated all 753 routes. External credentials were masked; the build used a dedicated local test database.
- Local production HTTP checks: both cron endpoints reject missing authorization with HTTP 401. With local cron authorization and no Google setup, recovery returns HTTP 200 `{accepted:false,reason:"not_configured"}` and readable sync returns HTTP 200 `{examined:0,queued:0,failed:0}`.

## Limits

This removes unnecessary workflow execution and associated queue/compute traffic. It does not erase charges already incurred or remove expected costs from real users, exports, cron invocations or other background work. Build configuration is unchanged. Production observation after Git deployment is recorded separately in the release evidence.
