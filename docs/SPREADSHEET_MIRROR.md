# Spreadsheet copies (Google Sheets + Microsoft Excel)

A team can keep two live copies of its Vantage data — one in Google Sheets, one in
Microsoft Excel — that always say the same thing. Connectors → **Spreadsheet copies**.

## What it is, and what it is not

- **Postgres is the source of truth.** Team data stays behind `org_id` row-level security;
  the spreadsheets are copies written *from* it. They are never the database: a spreadsheet
  cannot enforce "this team only", and a coach sorting a sheet must never be able to
  corrupt the pick list.
- **Two independent copies.** Google and Microsoft are separate providers with separate
  outages and separate rate limits. Either copy can be opened, shared, printed or pulled
  from while the other is down.
- **No TBA calls.** Teams and Matches come from Vantage's own cache of The Blue Alliance
  (`packages/reference`: one coordinated ingest worker, ETags, per-key rotation, freshness
  windows). The nightly mirror runs right after that ingest, so the copies carry the day's
  matches without a single extra TBA request, however many teams connect.

## How a sync works (`lib/mirror/mirror-sync.ts`)

1. One read of Postgres, one build of the tables (`buildWorkbookTables`) — both copies get
   exactly those tables, so they cannot drift through timing.
2. A content hash of the data tables is computed and written into each copy's `SyncInfo`
   sheet (`content_hash`), so a person can compare the two by eye.
3. Each copy is written on its own. One failing never stops the other.
4. A copy is stamped with the hash only when every table landed. Two copies with the same
   stamp hold the same data.
5. A provider that answers 429 / quota exhausted is rested (`throttled_until`, 1 minute to
   1 hour, honouring Retry-After). The other copy carries the load; the rested one is
   rewritten **in full** on the next sync, so nothing is lost.

Syncs run on "Sync both copies" (owner/admin, 6 per team per 10 minutes) and nightly from
the season cron (`lib/mirror/scheduled-mirror.ts`, falls back to the Excel-only job until
migration 0682 is applied). Every sync takes the same per-team advisory lock as the Excel
sync and the import, so writers never interleave.

## Pulling edits back (`lib/mirror/mirror-import.ts`, `mirror-merge.ts`)

"Pull edits from the spreadsheets" reads **every copy that is up**, least recently read
first (so reads alternate between providers), and merges them field by field:

| Situation | Result |
|---|---|
| Edit in one copy only | Taken from that copy |
| Same edit in both | One edit |
| Different edits to the same field | **Mirror conflict** — neither applied, both shown |
| Row deleted in one copy only | Still present (not reported as missing) |
| Copy throttled / signed out | Skipped with a reason; its edits are picked up next time |

The merged result then goes through the ordinary Excel import rules (allow-listed columns,
optimistic concurrency on `updated_at`, preview before apply) — see `MICROSOFT_EXCEL.md`.

## Setting up Google Sheets (once per deployment)

Google Sheets reuses the Google sign-in client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
In the Google Cloud project that owns that client:

1. **Enable the Google Sheets API.**
2. **Add the callback** to the OAuth client's authorized redirect URIs. The exact URL is
   shown on the Connectors card to owners/admins; it is
   `<GOOGLE_SHEETS_REDIRECT_ORIGIN or BETTER_AUTH_URL>/api/integrations/google/callback`.

Scope is `drive.file`: Vantage can create a spreadsheet and edit the files it created —
nothing else in the owner's Drive. The refresh token is envelope-encrypted with the same KMS
as the Microsoft connection and AI keys. The callback verifies an HMAC-signed, 15-minute
state bound to the user and team plus a PKCE verifier only this server can derive, so it
works even when Google returns the owner to a Vantage host where they have no cookie.

Microsoft Excel setup is unchanged: `MICROSOFT_EXCEL.md`.

## Data model (migration 0682)

- `org_google_sheets_connections` (owner/admin RLS) and the member-readable
  `org_google_sheets_connection_status` view.
- `last_sync_hash`, `last_read_at`, `throttled_until` on both connection tables.
- `workbook_sync_runs.target` (`excel` | `google`) and `content_hash`.
