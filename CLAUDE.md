# CLAUDE.md

Operational guide for working in this repo. Depth lives in `README.md` and `SECURITY_OPERATIONS.md`;
this file is the distilled "how to not break things" for an agent making changes.

## What this is

**Vantage** — a multi-tenant operations platform for FRC (FIRST Robotics Competition) teams: scouting,
Intel/Research, match prediction & strategy, CAD agent (Onshape/Fusion), pit/competition operations,
team chat, closed membership, configurable AI routing, and billing. Single public deployment is `apps/web`.

## Commands

```sh
npm run dev          # apps/web on http://localhost:3001 (waitlist/rate-limit use in-memory dev stores)
npm run lint         # eslint . (root)
npm run typecheck    # tsc --noEmit across every workspace (--workspaces --if-present)
npm test             # vitest run (credential-free unit tests)
npm run build        # build all workspaces
npm run test:browser # playwright (run `npx playwright install chromium` first)
npm run db:generate  # drizzle-kit generate
npm run db:migrate   # drizzle-kit migrate
```

Run a single package's checks from its dir (e.g. `npm run typecheck --workspace=@vantage/web`). Unit tests
and build are intentionally credential-free; RLS integration tests need a real Postgres with the migration roles.

## Layout

- `apps/web` — the only shipping deployment: marketing, legal/pricing/waitlist, Better Auth, and every
  session-protected product route (`app/<feature>/…` pages + `app/api/<feature>/route.ts`).
- `apps/marketing` — retirement shim; permanently redirects to `apps/web`. Don't add features here.
- `packages/db` — Drizzle schema, `withRls()` request client, worker-only `dbAdmin`, SQL migrations.
- `packages/core` — auth, tenancy, active-context, invite, notification, admin-audit helpers.
- `packages/billing` — credit enforcement, usage ledger, BYO-key envelope encryption, Stripe contract.
- `packages/reference` — TBA/Statbotics clients + worker-only idempotent writers + authenticated read repos.
- `packages/intel-research`, `packages/agent`, `packages/prediction-strategy`, `packages/scouting`,
  `packages/export-center`, `packages/cad` (+ `vantage-cad-cli`, `fusion360-official-connector`).

## Non-negotiable conventions

- **Tenancy/RLS is the security model, not a convenience.** Every request DB access goes through
  `withRls({ userId, orgId? }, async (client) => …)`, which sets `SET LOCAL app.user_id` / `app.org_id`.
  Product/request code must **never** import `@vantage/db/admin` (the worker role) — this is lint-blocked.
  Only queue/worker jobs use `dbAdmin` / `vantage_worker`.
- **Data access is raw parameterized SQL** through the `PoolClient` from `withRls` (see
  `apps/web/lib/strategy/compute-strategy.ts` or `apps/web/lib/impact/compute-impact.ts` for the pattern).
  Always use `$1,$2,…` params and cast explicitly (`$1::uuid`, `= ANY($3::text[])`). Never string-concat SQL.
- **New org-scoped tables** follow the pattern in `0024_competition_operations.sql` /
  `0038_community_impact.sql`: `org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`,
  `ENABLE ROW LEVEL SECURITY`, policies using `is_org_member(org_id)` /
  `has_org_role(org_id, ARRAY[...]::org_role[])` / `current_app_user_id()`, then
  `GRANT … TO vantage_app, vantage_worker`.
- **Migrations are append-only and run in numeric order.** Name the next file `NNNN_slug.sql` with the next
  free number — check `packages/db/migrations/` first; never reuse or renumber an existing one.
- **AI calls are metered.** Route model usage through the billing path (`meteredAI`, `feature=…`) which locks
  `org_billing`, sums the ledger, enforces caps, then appends usage. There is no denormalized credit counter.
- **Auth/onboarding.** Better Auth with Google + numeric email OTP. Access is closed: platform admin
  provisions each team/owner; owners/admins invite exact emails; everyone else → waitlist. Incomplete
  profiles are gated to `/onboarding`. Platform-admin surfaces (`/admin`) require a `platform_admins` row.
  `proxy.ts` auto-protects every non-public route — new `app/<feature>` pages need no extra auth gate.
- **Never invent demo/placeholder metrics.** Feature logic skips rows without real data and shows
  setup/empty states instead of fabricated numbers (see `packages/prediction-strategy`, `apps/web/lib/impact`).

## Environment gotchas

- **Windows / PowerShell** dev box. The Bash tool is Git Bash (POSIX); prefer forward slashes and `$VAR`.
- **Database is Neon Postgres** (`DATABASE_AUTH_URL` / `DATABASE_URL` app role, `DATABASE_ADMIN_URL` worker,
  `MARKETING_DATABASE_URL`). Do **not** migrate identity/RLS data to Supabase — Neon is production.
- Product routes need a real DB; without it they return `setup_required`/`empty` states rather than crashing.
- Many integrations are **setup-required by design** (Onshape OAuth, Stripe, Resend email 2FA, TBA key):
  code must degrade to a clear "configure X" state, never a hard failure, when env vars are absent.
- `E2E_AUTH_FIXTURE` is refused when `NODE_ENV=production`; the local KMS refuses to init in production.
- **TBA is a shared, rate-limited cache.** Read Neon reference tables first; never open parallel unrestricted
  TBA polls. One ingest worker uses ETag/`If-None-Match` + backoff.

## Verifying a change

Prefer `npm run typecheck` + `npm test` for logic. For a UI/route change, exercise the actual flow (the
`verify`/`run` skills). Note: this repo is often edited by more than one agent session at once — before a
large edit, check `git log --oneline -5` and file mtimes so you don't build on top of an in-flight refactor,
and prefer new files over editing hot shared ones.
