# Supabase plan sizing for Vantage

Researched 2026-08-24 against supabase.com. Every number here is attributed. Anything that
could not be confirmed on an official page is marked **UNVERIFIED** — do not treat those as
settled.

Companion to `docs/SUPABASE_CUTOVER.md` (how to move), `docs/STORAGE_NODE.md` (self-hosted
tier), and `docs/STORAGE_NODE.md` (running that tier on a NAS).

## Decision

**Supabase Pro ($25/mo), Small compute to start, Medium before January. Postgres only —
put photos, video, CAD, and PDFs in Cloudflare R2, not Supabase Storage.**

Team ($599/mo) buys 14-day backups and compliance paperwork, and **removes the spend cap**
(quote: *"This feature is available only with the Pro Plan"* —
[cost-control](https://supabase.com/docs/guides/platform/cost-control)). Nothing in it is
needed until a school district asks for a SOC 2 report.

Free is not a candidate: 500 MB database (read-only when full), 50 MB max upload, and
projects pause after a week of inactivity.

## Why media does not belong in Supabase

Modelled at 50 teams, year 3, video re-watched ~20× per season:

| Architecture | Peak month |
| --- | --- |
| Everything on Supabase | **~$3,080** |
| Postgres on Supabase + binaries on R2 | **~$355** |

≈ **$32,000/year**, and 84% of the expensive column is one line: **uncached egress**.

Three independent reasons, strongest first:

1. **R2 is cheaper on both axes.** Supabase Storage $0.0213/GB-mo vs R2 Standard $0.015/GB-mo,
   and egress $0.09/GB vs **$0** on R2
   ([storage-size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size),
   [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress),
   [R2 pricing](https://developers.cloudflare.com/r2/pricing/)). There is no volume of this
   workload where Supabase Storage wins.
2. **Its differentiator is unusable here.** What Supabase Storage adds over a plain bucket is
   storage RLS driven by Supabase Auth JWTs — which `SUPABASE_CUTOVER.md` explicitly forbids
   (Better Auth + `withRls` only, never the Data API keys). We would pay the premium for a
   feature we have ruled out.
3. **Signed URLs defeat the CDN.** The cheaper $0.03/GB cached rate needs CDN hits, but two
   different signed URLs for the same object *"each maintain their own independent cache
   entry"* ([smart-cdn](https://supabase.com/docs/guides/storage/cdn/smart-cdn)). A closed
   membership product mints a fresh URL per view, so budget **all** Supabase Storage egress at
   $0.09/GB.

### Where each asset class belongs

| Asset | Home | Why |
| --- | --- | --- |
| Relational data, scouting, chat, AI ledger, metadata | **Supabase Postgres** | Correct tool; RLS + `withRls` is the security model |
| Thumbnails (small, client-downscaled) | **Postgres `bytea`** — keep | ~80 MB/team/season; keeps grid rendering to one query |
| Photos (full size), CAD, PDFs | **Cloudflare R2** | Free egress, cheapest storage, S3-compatible |
| Video | **Cloudflare R2** behind a Cloudflare custom domain | Free egress; `<video>` + HTTP Range works directly |
| Bulk raw footage, LAN-speed pit access | **Self-hosted storage node / NAS** | Marginal cost $0 — already built (`0484`) |

Not Cloudflare Stream: per-minute *storage* pricing punishes a permanent archive
(~$300/mo in storage alone at 50 teams × 3 seasons —
[Stream pricing](https://developers.cloudflare.com/stream/pricing/)). Bunny Stream is a
reasonable later addition **for playback quality on venue Wi-Fi**, not for cost.

## Risks in the current code

1. **`bytea` media is a multi-tenant outage risk — fix first.** `0483_media_library.sql` and
   `0264_scout_media_bytes.sql` store bytes in Postgres. Disk is **$0.125/GB-mo** (~8× R2),
   database egress never hits a CDN, and every byte enters WAL, backups, and PITR. Supabase
   puts a project into **read-only mode at 95% disk**
   ([database-size](https://supabase.com/docs/guides/platform/database-size)) — so one team
   uploading match video on a Saturday can take *every other team* offline.
2. **Vercel's 4.5 MB body limit already blocks uploads.** Confirmed in
   [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — it applies
   regardless of fluid compute. A 6 MB phone photo fails today. The fix (direct-to-storage
   presigned uploads) is the same work as moving to R2.
3. **`withRls` is pooler-safe — keep it that way.** `set_config('app.user_id', …, true)` is
   transaction-local and Postgres discards it at commit, before a transaction-mode pooler can
   hand the connection on. But PgBouncer lists `SET`, `PREPARE`, and **session-level advisory
   locks** as never supported in transaction mode
   ([pgbouncer features](https://www.pgbouncer.org/features.html)). Stay on the **session
   pooler, port 5432**; never 6543. Note `meteredAI` uses `pg_try_advisory_xact_lock` —
   transaction-scoped, therefore fine.
4. **Never `await` an external HTTP call inside a `withRls` callback** — it pins a pooled
   backend for the duration.
5. **MAU is a red herring.** The 100,000 included MAU is *Supabase Auth*. We use Better Auth;
   our users are ordinary rows. Never size a plan on that line.

## Day one

1. Supabase **Pro**, one project, PostgreSQL 17+, region nearest the teams.
2. Compute **Small ($15)** now, **Medium ($60)** before January. Compute bills hourly — scale
   down in May.
3. **Spend cap OFF**, and enforce quotas in-app instead. With the cap on, exceeding a quota
   means *"further usage of that item is disallowed"* — read-only databases and 402s during a
   competition weekend is worse than a surprise invoice. `apps/web/lib/media-library/storage-meter.ts`
   already computes real per-org usage; wire a hard per-org cap to the upload path.
4. **Skip PITR ($100/mo) until the first team pays.** Pro's 7-day daily backups cover
   pre-revenue.
5. Set up the **R2 bucket and presigned direct uploads before the cutover**, and migrate
   `media_items.bytes` / `scout_media.bytes` out of Postgres. `storage-backend.ts` is already
   the right seam — add `r2` alongside `db` and `node`.
6. `pg` Pool `max: 2` per Vercel instance; audit `drizzle-client.ts` for `prepare: false`.
7. **First action on cutover day:** prove `vantage_app.<PROJECT_REF>` authenticates through
   the session pooler. If it does not, the plan changes.

## Revisit triggers

| Trigger | Action |
| --- | --- |
| Database > 50 GB | Size compute up; audit for `bytea` that should not be there |
| Database > 150 GB | Archive cold seasons to R2; review index bloat |
| Supabase uncached egress > 200 GB/mo | Something is serving bytes from Postgres — investigate before it bills |
| R2 storage > 10 TB (~$150/mo) | Evaluate R2 Infrequent Access for prior seasons |
| Any Supabase month > $400 | Line-item review; at this architecture that should be unreachable |
| Video buffering on venue Wi-Fi | Add Bunny Stream for video only — not preemptively |
| SOC 2 / HIPAA demanded | *Then* evaluate Team, remembering the spend cap is lost |

## Not verified

- Read replica pricing (docs defer to a page with no figure).
- Whether managed Supabase's non-superuser `postgres` can grant **`BYPASSRLS`**. Assume it
  cannot; the cutover doc's reliance on table ownership is the right path.
- Supavisor username format for **custom roles** (`vantage_app.<ref>`). `postgres.<ref>` is
  documented; the custom-role form is not. Test it first.
- Whether Supabase's CDN declines to cache objects above some size. Moot under this
  architecture; it would only make Supabase-hosted video worse, not better.

Key sources: [pricing](https://supabase.com/pricing) ·
[cost-control](https://supabase.com/docs/guides/platform/cost-control) ·
[egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress) ·
[disk-size](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size) ·
[database-size](https://supabase.com/docs/guides/platform/database-size) ·
[backups](https://supabase.com/docs/guides/platform/backups) ·
[smart-cdn](https://supabase.com/docs/guides/storage/cdn/smart-cdn) ·
[connecting-to-postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) ·
[roles](https://supabase.com/docs/guides/database/postgres/roles) ·
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) ·
[Vercel limits](https://vercel.com/docs/functions/limitations)
