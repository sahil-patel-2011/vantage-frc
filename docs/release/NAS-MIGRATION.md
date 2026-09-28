# PostgreSQL migration to the NAS

The NAS is a future database host. Vantage's initial launch continues using the current PostgreSQL host. This procedure is a controlled migration, not evidence that an unavailable NAS has already been tested.

## Prepare the host

Use PostgreSQL 17 initially, matching the verified recovery tooling. Install it in a maintained container or supported package. Put its data directory on persistent storage with adequate free space, filesystem checks and a UPS. Do not use the application container's writable layer for database files.

Keep PostgreSQL off the public internet. Establish an authenticated private network or database tunnel between the application and NAS, with connection pooling and a failover plan for loss of home internet. Vercel must reach that private endpoint reliably; a hostname that resolves only on the home LAN does not pass. Use TLS with certificate validation and restrict the database listener/firewall to the approved connection gateway. Test these requirements before scheduling a cutover.

Keep distinct application, authentication, worker, pairing and migration logins. Application connections must not be table owners, superusers, or hold BYPASSRLS. Recreate group roles and grants from the schema. Store connection strings in the deployment's secret environment, not Git, Sheets, logs or the runbook. Preserve a separately held copy of the recovery key outside both PostgreSQL and Google Sheets.

## Restore rehearsal

1. Produce and verify a fresh Google recovery checkpoint using the operator scripts. Check journal export lag, table coverage and readable-mirror failures before starting.
2. Download the recovery copy from Google with the separately held key. Restore it into an isolated PostgreSQL instance with no application traffic. The verification script deliberately permits only an empty local database containing `recovery_test` in its name. Restore an isolated local rehearsal first; do not relax that safety guard to target production.
3. For the NAS rehearsal, use an empty isolated database and the reviewed PostgreSQL restore commands. Verify encrypted archive integrity before decryption. Restore the schema, roles/grants, sequences, relationships and data; keep access closed while applying ordered journal batches and deletion records. Do not reopen with a snapshot older than the permitted recovery window or unresolved replay errors.
4. Revoke restored sessions, verification/pairing codes, device tokens, queued/leased jobs and export access tokens. Provider credentials require an explicit operator review before reuse. Existing records remain available after users sign in and reconnect.
5. Compare source and restored table inventories, row counts, stable-key samples, numeric precision, timestamps, JSON and sequence state. Exercise sign-in, two-team RLS isolation, offline scouting upload, inventory/finance transactions and deletion on controlled accounts. Run application queries using their actual least-privileged logins.

Automated journal replay, deletion enforcement and credential revocation must be verified before executing this cutover. The current checkpoint proof does not establish those gates.

## Cutover

Schedule a maintenance window and keep the previous host available. Pause writes and job dispatch, let active transactions finish, drain recovery exports, and record the last verified checkpoint and journal batches. Take a final verified recovery copy before changing connections.

Restore the final consistent copy on the NAS, apply remaining journals exactly once, verify the acceptance checks again, and compare schema/migration compatibility with the current application revision. Update the application's database role URLs together and redeploy the same application revision. Keep signup closed until the sign-in, team access, scouting, purchasing and recovery journeys pass against the NAS.

Observe connection failures, storage health, transaction latency, job lag and backup freshness through a full operating cycle. Retain the previous host and application release until the new installation passes those checks.

## Rollback

If the NAS has received no new writes, pause jobs and switch all database role URLs back to the previous host, then redeploy the previous known-good application release. Additive migrations are retained; do not reverse them destructively.

If the NAS has accepted new writes, stop both writers first. Preserve its latest recovery journals and snapshots. Replay and verify the changes into the rollback host, including deletions, before switching traffic. Never point two independent writable databases at the same team concurrently. A connection switch alone would discard work performed after cutover.
