# Base44 Dev Environment

## What this is

Vantage is a Next.js 16 (App Router) monorepo for FRC team operations. The web
app lives in `apps/web`; shared logic is in `packages/*` (npm workspaces).

## Running here

`docker compose -f docker-compose.base44.yml up -d` brings up two services:

- `install` — one-shot `npm install` at the repo root (sets up workspace symlinks).
- `web` — `next dev` from `apps/web` on port 3000, bind-mounted from source with
  live reload. Depends on `install` completing.

No database is required to boot. The app is designed to start without Postgres
and show setup states on product screens (see README "npm run dev"). DB env vars
fall back to `localhost:5432`; queries fail gracefully and pages render setup
states. `BETTER_AUTH_SECRET` falls back to a local dev secret outside production.

## Key facts

- Node 22+ required (compose uses `node:22`).
- `legacy-peer-deps=true` is set in `.npmrc` (needed for the dependency tree).
- Packages are TypeScript source consumed via `transpilePackages` in
  `next.config.ts` — no package build step is needed.
- `allowedDevOrigins` in `next.config.ts` references `BASE44_PUBLIC_HOST_SUFFIX`
  so the preview origin can reach dev assets/HMR. Do not hardcode the host.

## Optional: a real database

To see product data instead of setup states, add a Postgres service, set
`DATABASE_URL` / `DATABASE_ADMIN_URL` / `DATABASE_AUTH_URL`, and run
`npm run db:migrate` with the admin URL. The self-hosting guide is
`docs/SELF_HOSTING.md`; the runbook is `docs/DEPLOYMENT.md`.

## Verifying it works

- `docker compose -f docker-compose.base44.yml ps` — `web` should be healthy.
- `curl -I http://localhost:3000` — should return 200.
- The landing page at `/` is public; product routes redirect to sign-in.
