# Supabase cutover (Postgres host only)

Vantage can run on **Supabase Postgres** the same way it runs on Neon: one database, **org-scoped RLS**, Better Auth sessions. This is a host switch, not a product rewrite.

## What does not change

- **Better Auth** stays the identity system. Do not turn on Supabase Auth for product users.
- **`withRls`** still sets `app.user_id` / `app.org_id` inside a transaction. Team A cannot read Team B.
- Product code still uses parameterized SQL through `vantage_app`. Workers still use `vantage_worker`.
- **Do not** put `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `service_role` in the web app. The Data API must stay off for `public`.

## Team isolation

Every org-scoped table has `org_id` + RLS (`is_org_member` / `has_org_role`). AI chats, team memory, and artifacts are per workspace. Private AI threads export only for the requesting user (`/exports` → My private AI data).

## AI takeout (still private)

Owners/admins: **Exports** → Team-shared → **Select this team's AI takeout** → ZIP.

Members: **My private AI data** → **Select my AI takeout**.

Excluded: API keys, BYO envelopes, sessions, invite tokens, other orgs.

## Cutover steps (empty Supabase project)

1. Create the project on **PostgreSQL 17** (see "Postgres version" below).
2. In the SQL editor, run `packages/db/supabase/00_roles.sql`. Set LOGIN passwords for `vantage_app` and `vantage_worker`.
3. **Project Settings → Data API**: disable or leave unused. Migration `0432` revokes `anon` / `authenticated` on `public` if those roles exist.
4. `DATABASE_ADMIN_URL` = **direct or session-pooler** URI as `vantage_worker` (port **5432**, never 6543). Run `npm run db:migrate` — the authoritative `scripts/run-migrations.mjs` runner applies every file in `packages/db/migrations/` in filename order (~340 files, `0000` … `0496` and growing) and records each full filename in `schema_migrations`.
5. `DATABASE_URL` / `DATABASE_AUTH_URL` = **session-mode pooler** URI as `vantage_app` (port **5432** on the `pooler.supabase.com` host). Port 6543 is the transaction-mode pooler — see "Connection pooling and withRls" below before considering it.
6. `node scripts/supabase-preflight.mjs` — every line must be PASS (WARN lines reviewed). See "Preflight" below.
7. `node scripts/map-supabase-env.mjs` writes `.env.migrate.local`. Do **not** pass `--vercel` until you are ready to cut over production (`SUPABASE_CUTOVER_CONFIRM=I_UNDERSTAND`). Map the same aliases in the Vercel dashboard yourself if you prefer.
8. If the Vercel Supabase integration injects `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING`, the app already falls back to those. Still set `DATABASE_*` aliases so workers, auth, and billing keep least-privilege roles.
9. Optional: `DATABASE_DRIVER=pg` (auto-detected for `*.supabase.co` hosts).

## Preflight

After entering credentials (env vars or `.env.migrate.local` / `.env.production.local` / `.env.local`):

```sh
node scripts/supabase-preflight.mjs
```

One PASS/FAIL/WARN/SKIP line per check, zero secrets echoed, exit 1 on any FAIL. It verifies: URL shape
(rejects JWTs / `sb_secret_` keys / REST URLs), connectivity on all three URLs, pooler mode (see below),
server version, required extensions (`pgcrypto`), all nine `vantage_*` roles and the worker's RLS bypass,
the `schema_migrations` ledger vs local files (applied / pending counts), and an RLS smoke test — a random
`app.user_id` must see **0** rows in `organizations`. It is safe to dry-run against the current Neon env
today; Supabase-only checks report INFO/SKIP there.

## Postgres version

Neon production runs **PostgreSQL 17** (17.11 observed 2026-08). Create the Supabase project on major
**17 or newer** so a dump/restore never downgrades. The preflight enforces `>= 17`; override with
`PREFLIGHT_MIN_PG_MAJOR` only if you deliberately accept an older target.

## Roles

Nine `vantage_*` roles exist. Only `vantage_app` and `vantage_worker` need LOGIN + passwords
(`00_roles.sql` sets that up). The rest are NOLOGIN grant targets created by migrations —
`0001` (`vantage_app`, `vantage_worker` **BYPASSRLS**, `vantage_auth`, `vantage_marketing`),
`0007` (`vantage_billing`), `0009` (`vantage_display`), `0017` (`vantage_pairing`),
`0019` (`vantage_showcase`), `0033` (`vantage_alliance_board`).

Two Supabase-specific caveats:

- On Neon a privileged role ran `0001`, so `vantage_worker` carries **BYPASSRLS**. On Supabase you run
  migrations as `vantage_worker` itself, which cannot `ALTER ROLE … BYPASSRLS`. That is fine: the
  migration role then **owns** every table, and a table's owner skips RLS unless it is FORCED. The
  preflight accepts either shape and fails only when neither holds.
- `CREATE ROLE` inside migrations tolerates `duplicate_object`, **not** `insufficient_privilege`. If the
  migration role may not create roles, pre-create the NOLOGIN roles above in the SQL editor first (or run
  the migrations as a role with CREATEROLE).

## Connection pooling and withRls

`withRls` opens `BEGIN`, runs `set_config('app.user_id'/'app.org_id', …, true)` (transaction-local), does
the work, `COMMIT`s — all on one client. Supabase exposes two pooler modes on `pooler.supabase.com`:

- **Session mode (port 5432)** — one server connection per client for the life of the session. Normal
  Postgres semantics. **Use this for `DATABASE_URL` and `DATABASE_AUTH_URL`.**
- **Transaction mode (port 6543)** — the server connection is only pinned for the duration of a
  transaction. Inside `withRls`'s `BEGIN`…`COMMIT` the tenancy GUCs do hold, but **any query issued
  outside an explicit transaction** (Better Auth internals, health checks, ad-hoc reads) lands on an
  arbitrary server connection with **no tenancy state**, and session features (prepared statements,
  `SET`, advisory locks) break. The preflight WARNs on 6543 for app/auth URLs and **FAILs** for
  `DATABASE_ADMIN_URL`, because migrations and workers require session semantics.

`DATABASE_ADMIN_URL` should be the **direct** connection (`db.<PROJECT-REF>.supabase.co:5432`) or the
session pooler — never 6543.

## Vercel integration keys to ignore

The Supabase Vercel integration often adds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. **Leave them unused.** Product code must not import `@supabase/supabase-js` for tenancy. Better Auth + `withRls` stay the identity and isolation model.

## Do not

- Connect the app as the `postgres` superuser (bypasses RLS). Run `00_roles.sql` and switch to `vantage_app` / `vantage_worker` before going live.
- Use Supabase Storage/Auth as a second tenant model.
- Share one “AI project” across FRC teams — memory and threads are org-scoped on purpose.
- Cut over production from Neon in a drive-by change. This doc is the host-switch runbook; stay on the current Neon URLs until you deliberately migrate.
