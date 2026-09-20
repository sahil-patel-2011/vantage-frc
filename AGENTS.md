# Base44 Dev Environment

## What this is

Vantage is a Next.js 16 (App Router) monorepo for FRC team operations. The web
app lives in `apps/web`; shared logic is in `packages/*` (npm workspaces).

## Running here

`docker compose -f docker-compose.base44.yml up -d` starts a source-mounted,
live-reloading environment:

- `db` — local Postgres 17 with a persistent `pgdata` volume.
- `install` — one-shot root `npm install` for workspace links.
- `db-setup` — one-shot migrations, RLS login creation, realistic season seed,
  and local password-account seed. It is idempotent.
- `web` — `next dev` from `apps/web` on port 3000.

The database wiring mirrors `.github/workflows/web.yml`: migrations use the
local superuser, while runtime product and auth queries use non-superuser
`app_login` / `auth_login` accounts that automatically SET ROLE to
`vantage_app` / `vantage_auth`. Do not replace runtime URLs with the admin URL;
that would bypass RLS.

## Seeded sign-in

The local seed creates a populated Team 6925 season. For manual product checks,
sign in with `e2e-platform@vantage.local` and the password documented in
`scripts/seed-e2e-logins.mjs`. The dev flow may ask for a second factor; run
`docker compose -f docker-compose.base44.yml exec -T web node /app/scripts/dev-otp.mjs e2e-platform@vantage.local`
to obtain the local-only code.

## Key facts

- Node 22+ required (compose uses `node:22`).
- `legacy-peer-deps=true` is set in `.npmrc`.
- Packages are TypeScript source consumed via `transpilePackages`; no package
  build is needed for development.
- `allowedDevOrigins` in `next.config.ts` references
  `BASE44_PUBLIC_HOST_SUFFIX`; never hardcode the resolved preview host.
- `.env.base44-defaults` contains development-only fallbacks and is loaded
  before `/run/base44/app.env`, so dashboard-provided secrets always win.
- External integrations rejected or not configured by the user remain in their
  designed setup-required state; never fabricate provider credentials.

## Verification

- `docker compose -f docker-compose.base44.yml ps -a` — `db` and `web` healthy;
  `install` and `db-setup` exited 0.
- `curl -I http://localhost:3000` — returns 200.
- Production-style preflight from the repo root (explicitly omit local-only dev
  keys):
  `docker compose -f docker-compose.base44.yml exec -T web sh -lc 'cd /app && env -u DEV_KMS_MASTER_KEY -u DEV_OTP_SECRET NODE_ENV=production node scripts/deploy-preflight.mjs'`.
- The landing page is public; product routes require one of the seeded logins.
