# Build Vantage on Neon

Postgres is Vantage’s system of record. Production today is **Neon**. This page
is the copy-paste path for a new clone: create a Neon project, map the URLs this
repo actually reads, apply migrations, and verify. It is not a claim that
Neon-specific extensions or Neon branching are in use — they are not.

Identity stays **Better Auth** + `withRls`. Do not turn on Neon Auth, Supabase
Auth, or any Data API for product data.

Companion: [`.env.example`](../.env.example) (annotated catalog),
[`scripts/run-migrations.mjs`](../scripts/run-migrations.mjs) (authoritative
apply), [`scripts/map-neon-env.mjs`](../scripts/map-neon-env.mjs) (alias mapper),
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md) (Vercel production),
[`docs/SUPABASE_CUTOVER.md`](SUPABASE_CUTOVER.md) (optional later host switch —
product Postgres stays Neon until the owner cuts over).

## What Neon is in this repo

| Piece | What we actually do |
| --- | --- |
| Database | Postgres 16/17. Neon is the hosted Postgres. |
| Driver | `@neondatabase/serverless` for `*.neon.tech` hosts; `pg` (node-postgres) for local / generic hosts. Override with `DATABASE_DRIVER=pg` or `DATABASE_DRIVER=neon`. |
| Roles | `vantage_app` (request RLS), `vantage_worker` (migrations + workers), plus least-privilege roles created by early migrations. |
| Tenancy | `withRls` sets `SET LOCAL app.user_id` / `app.org_id` inside `BEGIN`…`COMMIT`. |
| Schema | Append-only SQL in `packages/db/migrations/`, applied by `npm run db:migrate`. |
| Extensions | `pgcrypto` (`CREATE EXTENSION IF NOT EXISTS` in `0000_foundation.sql`). We do not ship Neon-only extensions. |
| Branching | Unused as a first-class workflow. A Neon branch is just another pair of connection URLs — paste them the same way. This repo does not call the Neon Branches API. Preview Vercel builds skip unless the git ref is `main`. |
| Auth | Better Auth tables in the same Postgres. Not Neon Auth. |

## 1. Create a Neon project

1. Open [https://console.neon.tech](https://console.neon.tech) and create a
   project (Postgres 17 if the picker offers it).
2. Create a database. The default `neondb` is fine for a contributor clone.
3. In **Dashboard → Connect**, copy **two** connection strings:
   - **Pooled** (hostname contains `-pooler`, Neon’s PgBouncer).
   - **Direct** (same endpoint without `-pooler`). Neon also labels this
     `DATABASE_URL_UNPOOLED` when the Vercel integration injects env vars.

Do not copy the password into git, issues, or screenshots.

A Neon **role** named `vantage_app` / `vantage_worker` is nicer in production
(least privilege). A contributor clone may use the project’s default role for
both URLs until `npm run db:migrate` has created the SQL roles. The first
migrate needs a connection that can `CREATE ROLE` / `CREATE EXTENSION`
(Neon’s default owner can).

## 2. Map URLs to the env names this repo uses

The app does **not** read `NEON_DATABASE_URL`. It reads:

| Env var | Neon string to paste | Role / use |
| --- | --- | --- |
| `DATABASE_URL` | **Pooled** | Product requests (`vantage_app`, RLS). `@vantage/db` `withRls`. |
| `DATABASE_AUTH_URL` | Same pooled URL unless you split an identity role | Better Auth session store |
| `DATABASE_ADMIN_URL` | **Direct / unpooled** | `npm run db:migrate` and workers (`vantage_worker`) |
| `MARKETING_DATABASE_URL` | Pooled (or the same pooled URL until you split) | Waitlist / marketing. Falls back to an in-memory store when unset. |

Optional aliases, same pooled string until you provision dedicated Neon roles:
`DATABASE_BILLING_URL`, `DATABASE_DISPLAY_URL`, `DATABASE_ALLIANCE_BOARD_URL`,
`DATABASE_CAD_RELAY_URL`.

Fallbacks already in code (`packages/db/src/postgres-url.ts`):

- `POSTGRES_URL` → `DATABASE_URL`
- `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING` → `DATABASE_ADMIN_URL`

Prefer the `DATABASE_*` names so auth, workers, and billing keep distinct roles.

### Copy into `.env.local` (gitignored)

```sh
cp .env.example .env.local
```

Fill at least:

```sh
DATABASE_URL=postgresql://USER:PASSWORD@ep-….neon.tech/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://USER:PASSWORD@ep-….neon.tech/neondb?sslmode=require
DATABASE_AUTH_URL=postgresql://USER:PASSWORD@ep-….neon.tech/neondb?sslmode=require
DATABASE_ADMIN_URL=postgresql://USER:PASSWORD@ep-….neon.tech/neondb?sslmode=require
MARKETING_DATABASE_URL=postgresql://USER:PASSWORD@ep-….neon.tech/neondb?sslmode=require
BETTER_AUTH_SECRET=replace-with-a-long-random-string
BETTER_AUTH_URL=http://localhost:3001
```

Use the **pooler** hostname on `DATABASE_URL` / `DATABASE_AUTH_URL` and the
**direct** hostname on `DATABASE_ADMIN_URL`. If you only have one string, the
mapper will copy it to every alias and warn — migrations may still work on a
small project; workers and PgBouncer prepared statements will not.

### Mapper (real script, not a second CLI)

```sh
npm run db:map-neon
# same as: node scripts/map-neon-env.mjs
```

That writes gitignored `.env.migrate.local` with `DATABASE_ADMIN_URL` (direct),
`DATABASE_URL` (pooled), and `DATABASE_AUTH_URL`. It does **not** call
`vercel env add` unless you pass `--vercel` **and** set
`NEON_VERCEL_CONFIRM=I_UNDERSTAND`.

Secret-safe print (host + user, never the password):

```sh
node scripts/map-neon-env.mjs --print
```

`vantage-cad` (`npx vantage-cad`) is the CAD CLI. It is not a database CLI.
Do not look for a second `vantage` binary for Neon.

## 3. Apply migrations

```sh
npm run db:migrate
```

That is `node scripts/run-migrations.mjs`. It:

1. Reads `DATABASE_ADMIN_URL` (then `DATABASE_URL_UNPOOLED` /
   `POSTGRES_URL_NON_POOLING` / `DATABASE_URL`) from the environment or from
   `.env.migrate.local` / `.env.production.local`.
2. Ensures `schema_migrations(id, applied_at)`.
3. Applies every `packages/db/migrations/*.sql` file whose **full filename**
   is not already in the ledger, in lexicographic order, one transaction each.
4. Prints `APPLY` / `OK` or `SKIP`. On failure it rolls back, appends
   `scripts/migration-failures.log` (gitignored), and exits 1.

Re-run until the output is only `SKIP` lines.

```sh
npm run db:migrate -- --migration-env-file .env.migrate.local
```

There is no migrate-on-deploy hook. Production Neon is a deliberate run of
this same command against `DATABASE_ADMIN_URL`.

## 4. Minimal verify

```sh
npm run db:neon-preflight
# same as: node scripts/neon-preflight.mjs
```

Secret-safe `PASS` / `FAIL` / `WARN` / `INFO` lines. It never prints passwords.
Exit code 1 if any check fails.

Shape-only (no TCP), useful in CI or when the project is not created yet:

```sh
node scripts/neon-preflight.mjs --env-only
```

Live checks (when URLs are reachable): `SELECT 1`, server version, `pgcrypto`,
`vantage_app` / `vantage_worker` roles after migrate, and `schema_migrations`
vs local files.

Then:

```sh
npm run deploy:preflight
npm run dev
```

`http://localhost:3001` should boot. Product routes without a reachable database
still render `setup_required` rather than crashing.

## Pooled vs direct (what we do today)

`withRls` (request path) wraps **every** call in `BEGIN` … `SET LOCAL` … `COMMIT`.
That is why the pooled Neon URL is acceptable for `DATABASE_URL`: tenancy GUCs
are transaction-scoped. Do not query the request pool outside `withRls`.

`DATABASE_ADMIN_URL` must be the **direct** Neon URL. Migrations run multiple
statements per file; workers need session semantics. A `-pooler` hostname on
`DATABASE_ADMIN_URL` is a `WARN` in `neon-preflight`.

We do not use Neon’s HTTP fetch driver for tenancy. The serverless package is
the WebSocket `Pool` in `packages/db/src/pool.ts`.

## Code: request path (real module)

```ts
import { withRls } from "@vantage/db";

export async function loadForMember(userId: string, orgId: string) {
  return withRls({ userId, orgId }, async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM organizations WHERE id = $1::uuid AND is_org_member($1::uuid)`,
      [orgId],
    );
    return rows[0] ?? null;
  });
}
```

`withRls` lives in `packages/db/src/index.ts`. Request code is lint-blocked from
importing `@vantage/db/admin`.

## Code: migrate (real runner)

```sh
DATABASE_ADMIN_URL='postgresql://…direct…' npm run db:migrate
```

See `scripts/run-migrations.mjs` for the ledger insert. Do not apply files by
hand in the Neon SQL editor unless you also insert the filename into
`schema_migrations` — otherwise the next `npm run db:migrate` will try to apply
them again.

## Self-host without Neon

The same migrations and roles run on any Postgres 16/17 (Docker, a school
server, a VM). Use `DATABASE_DRIVER=pg` (auto for non-`neon.tech` hosts).
`sslmode=disable` is accepted only for localhost. That is the “freely hostable”
path: MIT license + this repo + a Postgres you control.

A later **Supabase Postgres host** cutover is documented in
`docs/SUPABASE_CUTOVER.md`. It is not the default. Do not put `anon` /
`service_role` keys in `DATABASE_*`.

## Owner-only (cannot be done from a clone)

- Create the Neon project and paste real URLs into gitignored `.env.local`
  (and into Vercel Production when you deploy).
- Set `CRON_SECRET` and the rest of the required vars in
  [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).
- GitHub’s license picker picks up root [`LICENSE`](../LICENSE) (MIT) on the
  default branch once this file is merged.
