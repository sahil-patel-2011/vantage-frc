# Google account capacity

The operator confirmed a **personal Gmail account** on September 26, 2026. The release must work within that account's limits. A Workspace subscription is not assumed.

Google currently documents **250 spreadsheet creations per user per day**, a six-minute execution limit, and 30 simultaneous executions per user. Quotas reset 24 hours after the first request and may change. Other Google product limits can also apply. See [Google's official quotas](https://developers.google.com/apps-script/guides/services/quotas).

## Implemented safeguards

Bridge protocol 6 routes all workbook, index and recovery spreadsheet creation through one locked helper. The single operator hub shares a conservative rolling 24-hour ledger across Vantage teams. Reservations are persisted before calling Google; an ambiguous failure is retained in the ledger. A uniquely named workbook left after an interrupted creation is reused before reserving another creation.

This ledger measures **this bridge's attempts**. It cannot report Google's remaining account quota, manual activity or other scripts' consumption. A provider quota exception blocks further creation attempts for up to 24 hours. Corrupt ledger data fails visibly instead of silently resetting the budget. The ledger must not be cleared to bypass quota limits.

Recovery reads and inspection never create a missing workbook. Existing registered workbooks remain usable when the creation allowance is exhausted. Index write failures are returned to the caller and are not treated as successful setup.

Provisioning saves a `waiting` state and the next retry time in PostgreSQL. Vercel Workflow schedules the retry without an in-process day-long timer. Completed phases and resource IDs are retained. The setup screen shows the wait and stops its animation; it does not fabricate a completion percentage or promise a five-minute result during quota exhaustion. Recovery journal export also defers provider throttling through durable retries, without acknowledging unverified events. Retries remain bounded; exhaustion becomes a visible failure requiring recovery.

## Remaining capacity acceptance

The required 50 simultaneous team setups need 250 workspace books. Fresh recovery or index creation would exceed a consumer account's daily allowance if every workspace is newly created in that window. The current journal allocator can also create many new books because it caps each book at 64 batches. Safe waiting is necessary, but does **not** establish the five-minute target.

Before release, implement and test a quota-aware supply of preallocated workbooks and recovery resource reuse/packing, including retention and deletion. Preallocated resources must still belong to the operator, have persistent assignment records, and survive concurrent allocation and interruption without duplicate claims. The 50-team load must start with a recorded account/resource capacity state and include real backup activity. Do not reduce the requested load, omit the five workspaces, or count waiting until tomorrow as passing the timing target.

The local protocol 6 source is tested. The existing owner deployment still uses script version 9 / protocol 5. Deploy the updated source to that **existing** deployment and verify actual resource reuse, errors, read-back, capacity and durable retries before recording live acceptance. No production Google quota exhaustion test has been performed.
