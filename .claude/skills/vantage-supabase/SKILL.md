---
name: vantage-supabase
description: >-
  How Vantage's production Postgres on Supabase is set up (roles, pooler modes, RLS, migrations)
  and how to read from it, change its schema and verify it safely. Use for any migration, any
  question about the production database, connection errors, or slow queries.
---

# Supabase (production Postgres)

Supabase is **only the Postgres host**. Identity is Better Auth; tenancy is `withRls` and Postgres
row-level security. Never use Supabase Auth, the Data API, or the `anon` / `service_role` keys
for product data. Neon is gone; never reconnect it. Never start a database on the owner's laptop.

- Project: `vantage-frc`, id `boskjvwpzrkoefuhttar`, region us-west-2 (Small compute).
- Hosted app: Vercel project `vantage-frc-web` (deploys are owner-approved; see
  `vantage-production-gotchas`).

## Connections and the pooler

The app connects through Supabase's pooler host (`*.pooler.supabase.com`) in two modes:

| Port | Mode | Use |
| --- | --- | --- |
| 5432 | session | one server connection per client, capped at the pool size (15 on Small) |
| 6543 | transaction | a server connection per transaction; what request traffic uses |

`packages/db/src/postgres-url.ts` (`pooledConnectionString`) rewrites request pools from 5432 to
6543 automatically. The provisioning pool asks for `poolMode: "session"` because it holds session
advisory locks. `DATABASE_POOL_MODE=session` turns the rewrite off everywhere (emergency only).

Session mode at 15 clients is why pages once failed with "max clients reached in session mode".
So in request code:

- Everything that needs the tenant goes inside one `withRls(...)` call (it uses `BEGIN` +
  `SET LOCAL`, which is safe in transaction mode). No `SET` outside a transaction, no session
  advisory locks, no `LISTEN`, no named prepared statements, no temp tables across statements.
- Keep transactions short. Do not call external APIs (TBA, AI, email) while holding a client.
- One page should cost a handful of queries, not one per row (100 teams × 12 widgets adds up).

## Roles and env vars

| Role (login user `*_login`) | Used by | Env var |
| --- | --- | --- |
| `vantage_app` | every request, under RLS | `DATABASE_URL` |
| `vantage_auth` | Better Auth tables | `DATABASE_AUTH_URL` |
| `vantage_worker` | jobs/queues only (`@vantage/db/admin`, `dbAdmin`) | `DATABASE_WORKER_URL` / `DATABASE_ADMIN_URL` |
| `vantage_billing`, `vantage_display`, `vantage_marketing`, `vantage_alliance_board` | narrow surfaces | `DATABASE_*_URL` |

Passwords are never printed, pasted, committed or put in a prompt. If you see one in a chat or log,
tell the owner to rotate it.

## Row-level security, in one paragraph

`withRls({ userId, orgId })` sets `app.user_id` / `app.org_id`. Policies call
`current_app_user_id()`, `is_org_member(org_id)`, `has_org_role(org_id, ARRAY[...]::org_role[])`,
`has_org_capability(org_id, '…')`, `is_platform_admin()`, `is_platform_owner()`. Banned teams
(0733) make `is_org_member` false. Org-scoped tables also carry the view-only guard policies
(0715): end any migration that adds an org table with `SELECT install_view_only_guards();` or
list the table in `view_only_exempt_tables` with a reason.

## Changing the schema

1. Write `packages/db/migrations/NNNN_slug.sql` with the next free number. Append-only;
   idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS` before re-create).
2. Apply it to the **local** database twice (second run proves idempotency); run the
   `*-postgres.test.ts` tests and the GUI flow against it.
3. Merge the code. The code must cope with the migration not being applied yet where it can
   (catch `42P01` undefined table / `42883` undefined function → a "setup required" state).
4. Production apply needs the owner's explicit OK. Applied migrations are recorded in
   `public.schema_migrations(id)`; record yours in the same transaction:
   `INSERT INTO public.schema_migrations(id) VALUES ('NNNN_slug.sql') ON CONFLICT DO NOTHING;`
5. **How to apply in production:**
   - The Supabase MCP connector (`apply_migration` / `execute_sql`) works for small, purely
     additive SQL. Any SQL whose text contains `DROP` or `DELETE` (even inside a function body or
     a string) is held for a confirmation and times out after 60s without running. Large
     payloads (~20KB+) time out too.
   - For anything else: give the owner one paste-ready file (the migration plus the
     `schema_migrations` insert) to run in Supabase → SQL Editor, and say exactly what it does.
   - Never split a migration into partial pieces that leave the schema half-changed unless each
     piece is safe on its own, and say which pieces ran.
6. Verify after apply (read-only, safe through `execute_sql`):

```sql
SELECT id FROM public.schema_migrations ORDER BY id DESC LIMIT 3;
SELECT to_regclass('public.<new_table>'), to_regprocedure('public.<fn>(<args>)');
```

Only then ask for the deploy that depends on it. Never deploy code that needs a migration the
production database does not have.

## Reading production safely

Read-only `SELECT`s through `execute_sql` are fine for checks: schema state, row counts, the
platform admin list, `pg_stat_activity` (look for lock waits and long transactions). Use
`get_logs` / `get_advisors` for errors and security/performance advisories. Do not read user
content you do not need, and never copy personal data into a PR, doc or prompt.

## When pages fail in production

Look at the runtime logs first (Vercel runtime logs, Supabase Postgres logs). Typical causes:
pool exhaustion (`EMAXCONNSESSION`), a query holding a lock, a missing migration (`42P01`), a
function signature changed by a migration but not by the code (or the reverse).
