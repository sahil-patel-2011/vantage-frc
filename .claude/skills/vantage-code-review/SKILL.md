---
name: vantage-code-review
description: >-
  How Vantage's code is structured and how to review it before changing it: where requests flow,
  where each kind of code lives, the conventions every file follows, and the checklist for reading
  existing code (and your own diff) before you change anything. Use before editing any file, when
  asked to review code or a PR, and before every push.
---

# Review before you change

## How a request flows

1. **`apps/web/proxy.ts`** runs first on every request: public-route allowlist, session check
   (Better Auth), email 2FA gate, onboarding gate (cached 30s per session in
   `lib/auth/onboarding-gate-cache.ts`), and team resolution (fills in `?orgId=` from the
   remembered team for signed-in pages; see `lib/nav/remembered-team.ts`). New pages under
   `app/<feature>` are protected automatically.
2. **Page** `apps/web/app/<feature>/page.tsx` (server) renders a client component
   `<feature>-client.tsx`, which fetches **`/api/<feature>`** (`app/api/<feature>/route.ts`).
3. **Route** gets the session, then does all data access inside
   `withRls({ userId, orgId }, async (client) => …)` from `@vantage/db`. That sets
   `app.user_id` / `app.org_id` with `SET LOCAL` in one transaction, and Postgres RLS does the
   tenant isolation. Domain logic lives in `apps/web/lib/<feature>/*.ts` (pure, unit-tested) and
   `packages/core` (auth, tenancy, onboarding, invites).
4. Writes that cross tenants or need elevated rights go through a narrow
   `SECURITY DEFINER` SQL function that checks the caller itself (pattern: 0720, 0727, 0733).

## Where things live

| What | Where |
| --- | --- |
| Pages and API routes | `apps/web/app/<feature>/`, `apps/web/app/api/<feature>/route.ts` |
| Feature logic (pure, tested) | `apps/web/lib/<feature>/` with colocated `*.test.ts` |
| Shared UI kit | `apps/web/components/ui/` (`Button`, `EmptyState`, `PageHeader`, `TabBar`, `Shell`…) |
| App frame | `apps/web/components/app-shell*.tsx` (sidebar, top bar, menus) |
| Hubs and tabs | `apps/web/lib/nav/hubs.ts`, `hub-navigation.ts`, `components/product-hub.tsx`; each hub page (`app/build/build-hub.tsx`…) embeds its tabs |
| Settings list | `apps/web/lib/nav/settings-nav.ts`, `components/settings-layout.tsx` |
| Auth, tenancy, onboarding | `packages/core/src/` (`index.ts` Better Auth config, `access-policy.ts`, `onboarding.ts`) |
| DB client, pools, migrations | `packages/db/src/`, `packages/db/migrations/NNNN_slug.sql` |
| Reference data (TBA/Statbotics) | `packages/reference/` (worker-only writers, read repos) |
| Billing / AI metering | `packages/billing/` (`meteredAI`, BYO keys) |
| Unit tests | colocated `*.test.ts` (vitest); Postgres tests `*-postgres.test.ts` need a real DB |
| Browser tests | `tests/browser/*.spec.ts` (Playwright) |
| Docs | `docs/README.md` index, `docs/FEATURE_MAP.md`, `docs/UI_DESIGN_RULES.md`, `docs/ROLES.md` |

## Conventions every change follows

- Parameterized SQL with explicit casts (`$1::uuid`, `= ANY($2::text[])`). No string-built SQL.
- Never import `@vantage/db/admin` (the worker role) from request code. It is lint-blocked; do
  not work around it.
- Migrations are append-only, numbered, idempotent where possible (`IF NOT EXISTS`,
  `CREATE OR REPLACE`). Never edit an applied migration.
- Roles: `owner`, `admin`, mentor-ish roles, `scout`, `viewer`, parent. Check capability with
  `has_org_role` / `has_org_capability` in SQL and the matching helper in TS; the UI hiding a
  button is never the security check.
- AI calls go through `meteredAI` with a `feature=` so usage is capped and logged.
- No fabricated data. Honest empty, setup and error states. Errors say what to do next.
- Comments explain *why*, in plain sentences, like the surrounding code.

## Checklist: reading existing code before changing it

1. What already does this, in full or in part? (`rg` the nouns, the route, the table.)
2. Who calls the function you are changing? (`rg -n "functionName("`) Change all callers or none.
3. What tests cover it? Run them first so you know they were green before you.
4. Which migration created the tables involved, and what RLS policies guard them?
5. Is this file also edited by another open branch? (`git log -3 --format='%h %an %s' -- <file>`)
6. What does the UI look like now? Take a "before" screenshot (vantage-gui-testing).

## Checklist: reviewing a diff (yours or someone else's)

- Tenancy: every read and write scoped by RLS or by an explicit caller check?
- Permissions: can a scout/viewer/parent reach this? Should they?
- Inputs: validated on the server (length, format, enum), not just in the form?
- Failure paths: DB down, integration missing, timeout, empty result, partial write?
- Concurrency: two people doing it at once; double submit; retry after a timeout.
- Scale: queries per page view; anything per-team in a loop; unbounded `SELECT`.
- Production-only behaviour (cookies, OAuth origins, email, pooler, serverless) — see
  `vantage-production-gotchas`.
- UI: matches `vantage-ui-design`; copy is plain, sentence case, no jargon.
- Tests added for the new logic, including the edge cases you thought about.
- Nothing staged by accident; no secrets, no `.env`, no screenshots of real user data.
