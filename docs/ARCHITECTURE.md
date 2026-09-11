# Vantage architecture

Single deploy: `apps/web`. Domain logic lives in `packages/*`. Request code uses `withRls` and parameterized SQL. Workers use `dbAdmin` via cron HTTP — not a second service.

## System of record: Postgres

Postgres is required, not optional. Every org’s membership, scouting, billing ledger, Better Auth
sessions, and TBA/Statbotics reference cache is a row in one database. There is no parallel
application datastore for product data.

- **Host today:** Neon (`docs/NEON.md`). Local Postgres and a documented Supabase **Postgres host**
  cutover (`docs/SUPABASE_CUTOVER.md`) use the same schema and roles. Identity is Better Auth, never
  Neon Auth / Supabase Auth / Data API keys.
- **Roles:** `vantage_app` (request path, RLS), `vantage_worker` (migrations + workers, typically
  `BYPASSRLS`), plus least-privilege roles created by early migrations (`0001_roles_and_rls.sql`).
- **Tenancy:** `withRls({ userId, orgId? })` in `packages/db/src/index.ts` runs `BEGIN`,
  `SET LOCAL app.user_id` / `app.org_id`, the work, then `COMMIT`. Request code must not import
  `@vantage/db/admin`.
- **Migrations:** append-only `packages/db/migrations/NNNN_slug.sql`, applied in filename order by
  `npm run db:migrate` → `scripts/run-migrations.mjs`, keyed by full filename in `schema_migrations`.
- **Pooling:** `DATABASE_URL` is the Neon **pooled** URL (request `withRls` is already a
  transaction). `DATABASE_ADMIN_URL` is the Neon **direct** URL. We do not use the Neon Branches
  API or Neon-only extensions (`pgcrypto` is stock Postgres).

## Kernel

- `@vantage/db` — RLS, `withRls`, worker-only `dbAdmin`, Drizzle schema, migrations (append-only; next
  file is the next free `NNNN`). Neon serverless driver on `*.neon.tech`; `pg` elsewhere.
- `@vantage/core` — Better Auth, invites, `claim_frc_team_workspace`, hub access
- `@vantage/billing` — `meteredAI`, ledger, Stripe
- `@vantage/reference` — TBA, Statbotics, Nexus clients; Postgres/Neon cache; no per-org TBA pollers

## Domain packages

- `@vantage/scouting` — schemas, QR, trust, import; seeds year packs from `@vantage/game-year`
- `@vantage/game-year` — year-agnostic packs (2026 REBUILT published; 2027 BIOCORE awaiting manual; field-centric `alliance_station`)
- `@vantage/import` — ICS, CSV column map, Notion page mapping (no invented rows)
- `@vantage/prediction-strategy` — match prediction math
- `@vantage/cad` — Onshape / Fusion agent (CAD stays in Onshape/Fusion)
- `@vantage/agent` — metered chat / tools
- `@vantage/intel-research` — research jobs
- `@vantage/export-center` — CSV/ZIP exports (org-scoped AI takeout; no keys)

## Hubs (jobs, not a catalog)

- Competition — Command, My Day, Scouting, Strategy, Pick desk
- Team — Calendar, Tasks, Hours, Knowledge, Messages, **Bring your season** (`/migrate`)
- Build — Kickoff, CAD, Code, Robot
- Business — Budget, Sponsors, Grants, Impact (FIRST Dashboard still submits awards)
- AI — layer on the above
- Media — calendar / kit

## Switching kit

`/migrate` + `@vantage/import`. Dual-run Notion/ICS/Sheets until the team disconnects. STIMS, WPILib, Onshape, Discord are not cloned.

## New feature rule

New capabilities land in a hub tab or domain package. Do not add an orphan `/slug` unless it is wired in `hubs.ts` and has a real compute module.
