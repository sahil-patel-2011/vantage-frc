# Operations and release checks

These instructions describe the implemented coordination. Production scheduling and alert
delivery remain unverified; this is not an operating-cycle acceptance record.

## Readable Google workbooks

The owner connection requires `VANTAGE_SHEETS_HUB_SECRET` and the registered hub URL or
`VANTAGE_SHEETS_HUB_URL`. Only server code receives the shared secret. `DATABASE_WORKER_URL`
must use the restricted `vantage_worker` role. Migration 0704 adds durable sync state and
includes that table in transactional recovery capture.

Authenticated members can trigger `/api/integrations/sheets/auto` for their own team. A
persistent job coalesces concurrent triggers. Each of the five workspaces is a separate
Workflow step. Completed work survives a later step's failure; provider waits save their
retry time and release the database connection. A generation ID prevents an old run from
overwriting a later run's state. Jobs that fail dispatch or become abandoned are eligible
for a later coordinator run. Unready teams cannot start readable sync.

The authenticated `/api/cron/readable-sheets` route dispatches due teams, including teams
with no browser open. Its every-minute schedule requires the inspected Vercel Pro plan.
Do not infer execution from `vercel.json`; observe actual invocations, Workflow callbacks
and database progress after deployment. Dispatch is bounded to 100 due teams per invocation
with four concurrent start requests; capacity beyond that bound must be measured.

Team admin displays saved state, completed workspaces, safe failure text, provider retry
time and real data age. `/api/integrations/sheets/hub-status` enforces membership and excludes
operator Drive IDs, secrets and internal workflow identifiers. `last_verified_at` is the
oldest source-read time across the five verified workspaces, rather than the completion
time. A five-minute warning does not change PostgreSQL records or claim data loss.

An unchanged remote stamp may skip verification only when its ID and hash match a
previously verified resource in PostgreSQL. A remote stamp left by an interrupted layout
check is verified on retry. Failed source reads stop the export. Changed values and layout
are checked before a workspace is acknowledged.

Operator monitoring should inspect failed/waiting jobs, provider retry times, uncompleted
workspaces and the age below. Never include authentication tokens, hub secrets or
invitation URLs in alert payloads.

```sql
SELECT org_id, state, error, retry_after_at,
       last_verified_at,
       extract(epoch FROM clock_timestamp() - last_verified_at) AS age_seconds,
       completed_workbooks
FROM team_readable_sync_jobs
ORDER BY last_verified_at NULLS FIRST;
```

Investigate a failed job or a data age above five minutes; absence of a first successful
refresh also needs attention. Check the corresponding Workflow state and platform logs,
then the owner bridge and provider quota. A rerun must reuse the registered folder and
workbooks. Do not delete resources to fix a timeout or reset a quota.

The [local evidence](evidence/journey-readable-google-sync.json) records one real five-book
refresh and an automatic unchanged refresh. The 50-team capacity test, complete readable
feature coverage, production execution and connected personal Excel/Google copies remain
separate acceptance work. Current workbook summaries also need a scope review: a table
absent from a workspace must not be represented as a recorded zero.

## Protected recovery and deployment

Readable workbooks are not the lossless recovery format. Keep the recovery key outside
Sheets and verify a checkpoint before production migrations. The recorded Google-only
restores establish bounded snapshot evidence; complete replay, deletions, sequences,
retention and session/device/job revocation still require acceptance.

Application rollback preserves additive migrations. Resolve the documented production
schema differences and restricted-role configuration before applying local migrations to
production. Keep self-service signup closed until every production journey and operational
gate in [the plan](PLAN.md) passes. Follow [the NAS runbook](NAS-MIGRATION.md) only after its
isolated migration and rollback rehearsal has been completed.
