# Microsoft Excel / OneDrive workbook sync

A team connects a Microsoft account (personal, or work/school) and Vantage keeps a structured
workbook in that account's OneDrive up to date: the event roster, the match schedule and results,
match and pit scouting, and the pick list. Coaches get a copy they can open, filter, chart and
share in Excel, and the team gets an off-platform backup.

Where it lives:

| Piece | Path |
| --- | --- |
| Migration | `packages/db/migrations/0671_microsoft_workbook_sync.sql` |
| Graph client (OAuth, retry, errors) | `apps/web/lib/microsoft/graph.ts` |
| Workbook layout | `apps/web/lib/microsoft/workbook-schema.ts` |
| Sync (Postgres → `WorkbookTarget`) | `apps/web/lib/microsoft/workbook-sync.ts` |
| Graph `WorkbookTarget` + OneDrive file helpers | `apps/web/lib/microsoft/workbook-target.ts` |
| Signed OAuth state + PKCE | `apps/web/lib/microsoft/oauth-state.ts` |
| Routes | `apps/web/app/api/integrations/microsoft/{connect,callback,status,sync,disconnect}` |
| Settings card | `apps/web/app/connectors/microsoft-excel-card.tsx` (on **Settings → Connectors**) |

---

## Architecture decision: Excel is a synced copy, not the database

### Context

The team already pays for Microsoft 365, which includes OneDrive storage, and asked whether Excel
could be "the database" for Vantage so that data lives in a place they already own and understand.

Vantage's data is written concurrently by many people at once: six or more scouts submit match
entries during the same match, the pick list is re-ranked live by several strategists, and offline
devices replay queued entries when they reconnect. Correctness today depends on things Postgres
provides and a spreadsheet does not:

- **Transactions.** A pick-list reorder renumbers every rank in one atomic step; a scouting submission
  and its audit trail commit together or not at all.
- **Constraints.** Unique keys (`match_scout_entries (org_id, client_id)`) make offline replay
  idempotent — a retried upload cannot create a duplicate entry.
- **Row-level security.** Every team's rows are isolated by `org_id` policies in the database itself
  (`withRls`), not by application code remembering to filter.
- **Throughput.** Microsoft Graph serializes and throttles writes per workbook; Microsoft's own guidance
  is to send one request at a time to a workbook and warns that concurrent writes cause throttling,
  timeouts and merge conflicts. Twenty devices writing to one file during a match would fail.

### Decision

Postgres (already running, on a free tier, with RLS, transactions and unique constraints) stays the
**single source of truth**. Microsoft Excel/OneDrive is a first-class **sync / export / backup**
integration: a team connects its Microsoft account, and Vantage writes a structured workbook into
that account's OneDrive whenever an owner or admin presses **Sync now**.

### Consequences

- Scouting stays safe under simultaneous use; nothing about the write path changes.
- The team gets a human-readable, coach-editable copy in storage it already pays for, usable offline in
  Excel and shareable with mentors who do not use Vantage.
- The workbook is a *copy*. Each sync rewrites the `Vantage*` tables from Postgres, so an edit typed into
  those tables is overwritten on the next sync. Coaches should keep their own formulas, charts and notes on
  their own sheets, referencing the Vantage tables by name (e.g. `=AVERAGEIFS(VantageMatchScouting[data.autoPoints], VantageMatchScouting[team_number], 254)`).
- Bringing edits back from Excel into Vantage is a separate, deliberate feature (see *Not done yet*), not
  a side effect of the sync.
- One more connector to operate: an Azure app registration and its client secret, which expires and must be rotated.

---

## Setting it up (free)

An Azure app registration costs nothing and does not need an Azure subscription.

1. Sign in to the Microsoft Entra admin center (<https://entra.microsoft.com>) → **Identity → Applications →
   App registrations → New registration**. (Or <https://portal.azure.com> → *App registrations*.)
2. **Name:** `Vantage` (anything; users see it on the consent screen).
3. **Supported account types:** choose **"Accounts in any organizational directory (Any Microsoft Entra ID
   tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**. This is required for
   personal Microsoft 365 / OneDrive accounts; the narrower options reject them.
4. **Redirect URI:** platform **Web**, value
   `https://<your deployment>/api/integrations/microsoft/callback`
   (for local development: `http://localhost:3001/api/integrations/microsoft/callback`). The Connectors card
   shows the exact URL to paste to owners/admins while the integration is not configured.
5. After creating it, copy **Application (client) ID** → `MICROSOFT_CLIENT_ID`.
6. **Certificates & secrets → New client secret** → copy the **Value** (not the Secret ID) →
   `MICROSOFT_CLIENT_SECRET`. Note the expiry date; a secret that expires stops every team's sync
   (they will see "Microsoft sign-in expired or was revoked" until it is replaced).
7. **API permissions:** the defaults (`User.Read`) are fine; Vantage requests the rest at sign-in (below).
   No admin consent is needed for these delegated permissions in most tenants; a school tenant that blocks
   user consent will need its IT admin to approve the app once.
8. Set the environment variables on the deployment and redeploy.

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `MICROSOFT_CLIENT_ID` | yes | Application (client) ID of the app registration. |
| `MICROSOFT_CLIENT_SECRET` | yes | Client secret value. Server-only. |
| `MICROSOFT_TENANT` | no | `common` (default: personal + any work/school), `organizations`, `consumers`, or one tenant id. |
| `MICROSOFT_REDIRECT_URI` | no | Override the callback URL (defaults to `BETTER_AUTH_URL` + `/api/integrations/microsoft/callback`). |
| `BETTER_AUTH_SECRET` | yes (already set) | Signs the OAuth `state` and derives the PKCE verifier. Production refuses to connect without it. |
| `AWS_KMS_KEY_ID` | yes in production (already used for BYO keys) | Envelope encryption of the stored refresh token. |

With `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` unset, every route and the card report
*"Connect Microsoft needs a Microsoft app registration — see docs/MICROSOFT_EXCEL.md"* instead of failing.
Until migration 0671 is applied, they report that a database update is needed.

### Permissions requested, and why

Delegated permissions only — Vantage acts as the person who connected, inside their own OneDrive.

| Scope | Why |
| --- | --- |
| `offline_access` | Returns a refresh token, so a later **Sync now** works without that person signing in again. |
| `Files.ReadWrite` | Create the `Vantage` folder and the workbook, and write its sheets. Only the signed-in user's own files; **not** `Files.ReadWrite.All`, not SharePoint sites. |
| `User.Read` | Read the account's display name and email so the card can say whose OneDrive holds the workbook. |

The refresh token is stored envelope-encrypted (`encryptSecret` from `packages/billing`, the same AES-256-GCM
+ KMS-wrapped data key used for BYO AI keys) in `org_microsoft_connections`. Only owners/admins can read that
table under RLS; other members read `org_microsoft_connection_status`, a view with no ciphertext columns. No
route ever returns a token, and tokens are never logged.

### The connect flow

1. Owner/admin presses **Connect Microsoft** → `GET /api/integrations/microsoft/connect?orgId=…`. The role is
   checked server-side; the route redirects to
   `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` with `response_type=code`, the scopes,
   a signed `state` (HMAC-SHA256 over `{purpose, orgId, userId, nonce, issuedAt}`, 15-minute expiry,
   domain-separated from the GitHub connector's state) and a PKCE `S256` challenge.
2. Microsoft redirects to `/api/integrations/microsoft/callback`. The callback verifies the state, checks it names
   the signed-in user, re-checks owner/admin, exchanges the code (with the PKCE verifier, derived from the
   state's nonce with the server secret — nothing stored between the two requests), reads `/me`, finds or
   creates `/Vantage/Vantage – Team <number>.xlsx` in that OneDrive, and stores the encrypted refresh token.
3. The browser lands back on **Connectors** with `?microsoft=connected` (or `?microsoft=error&reason=<code>`).

Disconnect deletes the stored token and the link. The workbook stays in OneDrive — it is the team's file.
To also revoke Vantage's access on the Microsoft side: <https://account.microsoft.com/privacy/app-access>
(personal accounts) or the tenant's Enterprise applications page (work/school).

---

## Workbook layout

One worksheet and one Excel table per entity, written in this order. Every table has:

- `id` — a stable key from Postgres: a uuid, or a natural key (TBA `match_key`, `team_key`). **Never a row
  number.** Rows are rewritten on every sync, and any future import must match on `id`.
- `updated_at` — when Vantage last changed that record, ISO-8601 UTC.
- `source` — where the record came from.

Blank cells mean "no data", never zero. Nothing is invented: a team with no scouting gets an empty table.

**Scope:** Teams, Matches, and the pick list cover the team's **active event** (Settings → active event,
`org_active_context`). With no active event set, Teams and Matches are empty and scouting covers every event
the team has scouted. Each table is capped at 20,000 rows; SyncInfo reports any truncation.

### `Teams` (table `VantageTeams`) — the active event's roster

Teams with metrics for the event, plus every team on the match schedule.

`id` (team_key, e.g. `frc254`), `team_number`, `nickname`, `name`, `city`, `state_prov`, `country`,
`rookie_year`, `epa_total`, `epa_auto`, `epa_teleop`, `epa_endgame`, `opr`, `dpr`, `ccwm`, `rank`, `wins`,
`losses`, `ties`, `event_key`, `updated_at`, `source` (`metrics:<statbotics|tba…>` or `match_schedule`).

### `Matches` (table `VantageMatches`)

`id` (match_key), `event_key`, `comp_level`, `set_number`, `match_number`, `red_1`, `red_2`, `red_3`,
`blue_1`, `blue_2`, `blue_3`, `red_score`, `blue_score` (blank until played), `winning_alliance`,
`scheduled_time`, `actual_time`, `updated_at`, `source` (`tba` or `scout_placeholder`).

### `MatchScouting` (table `VantageMatchScouting`)

`id` (entry uuid), `event_key`, `match_key`, `team_key`, `team_number`, `scout` (name), `confidence`,
`created_at`, `updated_at`, `source` (`manual` | `voice` | `import` | `video`), then one `data.<field>`
column per scouting-form field.

### `PitScouting` (table `VantagePitScouting`)

`id` (entry uuid), `event_key`, `team_key`, `team_number`, `scout`, `confidence`, `created_at`, `updated_at`,
`source`, then `data.<field>` columns.

**Scouting fields.** The form payload (jsonb) is flattened into `data.<key>` columns: the union of keys across
all rows in the table, sorted by code point (identical on every machine), so the column order is stable
between syncs. At most 60 `data.*` columns; any further keys are kept, as JSON, in a final `data._more`
column. Nested values are written as JSON text. When a new field appears, the sheet is rebuilt with the new
column set.

### `PickList` (table `VantagePickList`)

The team's most recently edited pick list for the active event (the same list every pick-list surface shows).

`id` (entry uuid), `pick_list_id`, `list_name`, `list_status`, `event_key`, `rank`, `team_key`,
`team_number`, `nickname`, `bucket`, `tier`, `notes`, `weighted_score`, `vote_count`,
`drafted_alliance_seed`, `drafted_pick_slot`, `updated_by`, `updated_at`, `source` (the list's source surface).

### `SyncInfo` (table `VantageSyncInfo`)

Key/value rows: `id` (key), `value`, `updated_at`, `source` (`vantage`). Keys: `about`, `team_number`,
`team_name`, `active_event_key`, `synced_at`, `schema_version`, `rows.<Table>` for each table, and
`rows.truncated`.

### Cell safety

Text that Excel would evaluate as a formula (starting with `=`, `+`, `-`, `@`, tab or CR — except plain
numbers such as `-3`) is written with a leading apostrophe, so a scout note like `=HYPERLINK(…)` stays text.
Text is capped at Excel's 32,767-character cell limit.

---

## Idempotency, retries, and failure behaviour

**Replace, not append.** For each table the sync (1) ensures the sheet and table exist with exactly the
expected header row (rebuilding the sheet if the columns changed), (2) deletes every body row after the first,
(3) overwrites the first body row, and (4) appends the remaining rows with `rows/add` in batches of at most
500. Running a sync twice on unchanged data produces an identical workbook; a sync that failed halfway is
repaired by the next one. Keeping one body row means the result never depends on how Excel treats a
zero-row table (with no data, the table has one blank row).

**One session, sequential calls.** A sync opens one persistent workbook session
(`createSession`, `persistChanges: true`) and sends every write one at a time, as Microsoft recommends.
Microsoft documents `createSession` as unsupported for personal accounts; there the sync continues without a
session (sessionless calls are persisted). A typical sync is about 25–35 Graph requests.

**One sync per team at a time.** The sync runs in one `withRls` transaction holding a transaction-scoped
advisory lock on the team; a second **Sync now** while one is running returns "already running".

**Retries** (`fetchWithRetry` in `graph.ts`): only HTTP 429, 503 and 504 are retried, up to 4 attempts.
`Retry-After` is honoured when present (seconds or HTTP-date); if it asks for more than 30 s the call fails as
*throttled* rather than holding the request open. Without `Retry-After`: exponential backoff with full jitter
(base 500 ms, cap 8 s). Every request has a 20 s timeout; a timeout or network failure is **not** retried,
because a write that timed out may have landed. A retried 504 on `rows/add` can, rarely, duplicate a batch —
the next sync's replace removes it.

**Errors** map to `auth_expired` (401, or token errors `invalid_grant` / `interaction_required` /
`consent_required`), `throttled` (429), `not_found` (404), `conflict` (409/412), `unavailable` (5xx, timeouts),
`forbidden` (403), `bad_request` (other 4xx). The card shows a plain-language sentence for each.

**Outcomes.** Every attempt writes a `workbook_sync_runs` row: `succeeded`; `partial` (some tables failed —
`tables_written` records which and why, and the other tables were still written); or `failed`. An expired
sign-in stops the remaining tables immediately. The connection's `last_error` is set on `partial`/`failed` and
cleared on success. If the workbook was deleted or moved, the next sync recreates it at the same path. The
refresh token Microsoft rotates on each use is re-encrypted and stored.

**Rate limit.** `POST /sync` allows 6 syncs per team per 10 minutes.

### Limits

- Microsoft does not publish fixed Excel API limits; throttling depends on workbook size and load
  (<https://learn.microsoft.com/en-us/graph/workbook-best-practice>). Large events with many scouting fields
  are the most likely to see `throttled`; waiting and syncing again is the fix.
- Syncs run on request (owner/admin presses **Sync now**), inside one serverless invocation (`maxDuration` 60 s).
  The daily season cron also syncs every connected team whose workbook is more than 20 hours old (`lib/microsoft/scheduled-sync.ts`), running as the person who connected Microsoft and only while they are still an owner or admin. A team whose sign-in was revoked is skipped until someone reconnects.
- The workbook must not be locked for editing in a way that blocks co-authoring; a `conflict` asks the user to
  close it and retry.
- 20,000 rows per table, 60 flattened scouting columns (the rest in `data._more`).

---

## Not done yet (designed, deliberately not built)

### Import from Excel back into Vantage

Useful for coaches who annotate the pick list or correct a scouting typo in Excel. It is intentionally not
part of the sync, because a two-way sync without rules silently loses data. The design, for a follow-up:

1. **Explicit, previewed action.** An owner/admin presses **Import changes from Excel**. Vantage reads the
   `Vantage*` tables (`GET …/tables/{name}/range` values), diffs them against Postgres by `id`, and shows a
   preview: rows changed, fields changed, rows it cannot match. Nothing is written until confirmed.
2. **Allow-listed columns only.** Only human-owned fields are importable — pick-list `rank`, `bucket`, `notes`;
   scouting `data.*` fields and `confidence`. Keys, `event_key`, `team_key`, `source`, timestamps, and all
   TBA/Statbotics-derived columns are read-only; edits there are reported, not applied.
3. **Optimistic concurrency.** Each row's `updated_at` in the workbook is the version it was exported at. If
   Postgres has changed since (someone re-ranked in Vantage after the sync), that row is a conflict shown in
   the preview, never overwritten. Pick-list writes go through `lib/picklist/store.ts` (with its `revision`
   checks), scouting edits through the normal author-or-admin update path, so RLS and audit apply unchanged.
4. **No deletes, no inserts** in the first version: a row deleted in Excel is reported, not deleted in
   Vantage; new rows without an `id` are ignored.
5. Record every import as a run (a `workbook_import_runs` table mirroring `workbook_sync_runs`).

### Also not done

- Sync right after scouting activity (today: nightly, plus Sync now).
- Choosing a different folder, file, or a SharePoint/Teams document library (needs `Sites.*` scopes).
- Multiple workbooks per team (e.g. one per event).
