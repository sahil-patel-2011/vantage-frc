# Contributing to Vantage

Vantage is MIT-licensed and meant to be cloned, self-hosted, and patched. This
file is the path for a new contributor who has never talked to the owner.

## Before you write code

1. Read [`README.md`](README.md) (what the repo is) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
   (how it is shaped).
2. If your change touches Postgres, tenancy, or env vars, read [`docs/NEON.md`](docs/NEON.md)
   and [`CLAUDE.md`](CLAUDE.md).
3. Do not invent demo metrics, fake social proof, or placeholder scores. Empty
   states and `setup_required` are the honest answers when data is missing.

## Run locally (no cloud credentials)

```sh
npm install
cp .env.example .env.local
npm test
npm run typecheck
npm run lint
npm run dev
```

`npm test` and `npm run build` are credential-free. Product routes without Postgres
render `setup_required` / empty states instead of crashing.

The app listens on `http://localhost:3001`.

## Run against Postgres

Postgres is the system of record. You need it for sign-in, RLS, and anything
that is not a unit test.

- **Neon (preferred hosted path):** [`docs/NEON.md`](docs/NEON.md) — create a
  project, copy the pooled and direct URLs into the env names this repo actually
  uses, run `npm run db:migrate`, then `npm run db:neon-preflight`.
- **Local Postgres:** same roles (`vantage_app`, `vantage_worker`) and the same
  `npm run db:migrate` runner (`scripts/run-migrations.mjs`). Point
  `DATABASE_ADMIN_URL` at a dedicated database whose name contains `test` or
  `ci` before running `npm run test:db:integration`.

CAD work uses `npx vantage-cad` ([`docs/CLAUDE_CODE_CAD.md`](docs/CLAUDE_CODE_CAD.md)).
That CLI is Onshape/Fusion, not the database. Do not invent a second database CLI.

## How to help

Useful first contributions, in order of how easily a new clone can verify them:

1. **Tests** for an existing empty/offline/copy path that already has a sibling
   `*.test.ts`.
2. **Docs** that match real scripts and real env names (`.env.example`,
   `scripts/run-migrations.mjs`, `scripts/map-neon-env.mjs`).
3. **Copy** that a student would see — `copy-lint.test.ts` is the lock.
4. **A single product route** that is already registered in `docs/FEATURE_MAP.md`.

Open an issue with the templates under `.github/ISSUE_TEMPLATE/` before a large
change. Pull requests use `.github/PULL_REQUEST_TEMPLATE.md`.

## Non-negotiable engineering rules

- **Tenancy is RLS, not an application filter.** Request DB access goes through
  `withRls({ userId, orgId? }, async (client) => …)` in `@vantage/db`. Product
  request code must never import `@vantage/db/admin`.
- **SQL is parameterized.** `$1`, `$2`, … with explicit casts. Never string-concat
  SQL.
- **Migrations are append-only.** Next file is `packages/db/migrations/NNNN_slug.sql`
  with the next free number. Never reuse or renumber.
- **AI is metered.** Route model usage through `meteredAI` (`feature=…`).
- **Secrets stay out of git.** `.env*` is gitignored except `.env.example`. Never
  paste Neon passwords, `DATABASE_*` URLs, or provider keys into issues, PRs,
  or `docs/STATUS.md`.

## Verification before you push

```sh
npm run lint
npm run typecheck
npm test
```

If you touched migrations: `npm run test:migrations`. If you touched a UI route,
exercise that route; a screenshot is not verification.

## License

By contributing you agree the work is released under the MIT License in
[`LICENSE`](LICENSE).
