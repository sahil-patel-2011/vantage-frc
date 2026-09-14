# Contributing to Vantage

*For anyone changing the code — including AI coding agents, which should also read
[CLAUDE.md](CLAUDE.md). Last reviewed September 2026.*

## Setup

```sh
npm install                       # Node 22 or newer
cp .env.example apps/web/.env.development.local
npm run dev                       # http://localhost:3001
```

The app boots without a database; product screens show their setup states. For real behaviour you
need Postgres. **Preferred hosted path:** create a Neon project and follow
[docs/NEON.md](docs/NEON.md) (`npm run db:map-neon`, `npm run db:migrate`,
`npm run db:neon-preflight`). **Local Postgres:**

1. Create a UTF-8 database and apply every migration:
   `DATABASE_ADMIN_URL=postgres://… node scripts/run-migrations.mjs`
2. Create login roles for `vantage_app`, `vantage_auth` and `vantage_marketing` (the SQL is in
   [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
3. Put the URLs in `apps/web/.env.development.local`. That file is git-ignored and is read by
   `next dev` only. **Never point a local run at a production database.**

## Where things live

| Path | What it is |
|---|---|
| `apps/web/app/<feature>/` | Pages and their client components |
| `apps/web/app/api/<feature>/route.ts` | API routes — thin: parse, `withRls`, call a compute module, respond |
| `apps/web/lib/<feature>/` | Compute modules, copy, tests for that feature |
| `apps/web/lib/nav/` | Navigation model (`hubs.ts`), redirects, command search |
| `packages/*` | Shared domain logic (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) |
| `packages/db/migrations/` | Append-only SQL migrations |
| `docs/` | Documentation, indexed at [docs/README.md](docs/README.md) |

## The rules that keep the product safe

These are enforced by lint or tests where possible. Read them once.

1. **Every request database access goes through `withRls({ userId, orgId })`.** Product code never
   imports the worker client (`@vantage/db/admin`); lint blocks it.
2. **SQL is parameterized with explicit casts** (`$1::uuid`, `= ANY($2::text[])`). Never build SQL
   from strings.
3. **Migrations are append-only.** Take the next free number in `packages/db/migrations/`. Every new
   team-scoped table has `org_id`, row-level security, policies and grants — copy an existing
   migration's pattern — and a block in `scripts/rls-proof.mjs`.
4. **AI calls are metered** through `meteredAI` (request path) or the relay adapter (worker path), and
   tagged with a feature name.
5. **Never invent a number.** No demo values, no placeholders. An empty state says what is missing
   and what to do.
6. **Copy is for students.** User-facing text says what the person sees and what to do next.
   Engineering vocabulary ("org-scoped", "RLS", "fixture", "DEMO") is blocked by
   `apps/web/lib/ui/copy-lint.test.ts`.
7. **One primary action per screen, nothing three levels deep.** The interface rules are in
   [docs/UI_DESIGN_RULES.md](docs/UI_DESIGN_RULES.md).
8. **Integrations degrade honestly.** When a credential is missing, show what to set and where, never
   a blank card or a 500.
9. **Two scheduled jobs, no more.** New daily work is a piggyback on the season cron, not a third
   cron (Vercel Hobby limit).
10. **Do not weaken a test to make it pass.** Change a pinned expectation only when the design changed
    on purpose, and say so in the commit.

## Verifying a change

Run before every push:

```sh
npm run typecheck                        # every workspace
npm run lint
npm test                                 # ~8,600 tests in about 90 seconds
npm run build --workspace=@vantage/web   # zero warnings — a warning once hid eleven dead media queries
npx playwright install chromium          # once per machine (`npm run test:browser:install`)
npm run test:browser                     # Playwright vs http://127.0.0.1:3310 (E2E_AUTH_FIXTURE=1, local vantage_ci)
```

`npm run test:browser` runs four sequential shards. Each shard starts its own
`next dev` against `NEXT_DIST_DIR=.next-pw` (4 GB `NODE_OPTIONS`) and evicts that
cache afterwards so compiled routes do not accumulate. A named spec
(`npm run test:browser -- tests/browser/chat-remaining.spec.ts`) skips sharding.
`PLAYWRIGHT_SHARDS=1` forces a single process. Playwright uses `.next-pw` and
does not attach to a leftover human `next dev` unless you set
`NEXT_DIST_DIR=.next` or `PLAYWRIGHT_BASE_URL`.
`PLAYWRIGHT_PORT=3510 npm run test:browser` still starts a server when no lock is
live. To attach to a server you already started on another port:
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:3410 npm run test:browser:attach`. Never point
Playwright at production `DATABASE_*`.

For a screen change, load it in a browser on a local database and write down what you saw. For a
database change, run `scripts/rls-proof.mjs` against a local Postgres as a non-superuser login. For a
deploy-affecting change, `node scripts/deploy-preflight.mjs`.

`next build` rewrites `apps/web/next-env.d.ts`; run `git checkout -- apps/web/next-env.d.ts` before
committing.

## What a pull request needs

- Small, logical commits whose messages say what was wrong and why the change is right
- The checks above green, with the test summary line in the description
- New tables in the RLS proof; new screens in [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) and the
  in-app manual (`apps/web/lib/help/articles.ts`); new environment variables in
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- An honest note of anything you could not verify (no credentials, no device) — say so rather than
  claim it

CI runs lint, types, unit tests and the production build, then applies every migration to a fresh
Postgres and runs the RLS proof. Playwright runs on demand.

## Working alongside other people and agents

This repository is often edited by more than one session at once. Before a large edit, check
`git log --oneline -5` and prefer new files over editing hot shared ones. Commit early and often —
only committed, pushed work survives a session that dies. Agent worktrees under `.claude/worktrees`
contain junctions into the main `node_modules`; remove them with `git worktree remove`, never
`rm -rf`.

## Reporting problems

Open a GitHub issue. For anything security-related, see
[SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md) for how to report it privately.

## License

By contributing you agree the work is released under the MIT License in
[`LICENSE`](LICENSE).
