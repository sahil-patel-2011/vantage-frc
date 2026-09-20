# Base44 sandbox notes

Repo conventions live in `CLAUDE.md`. This file covers only how the app runs here.

## Run it

```sh
docker compose -f docker-compose.base44.yml up -d --build
```

Services: `db` (postgres 17) → `deps` (one-shot `npm install` at the repo root) → `migrate`
(one-shot `node scripts/run-migrations.mjs`, ~666 SQL files, a few seconds) → `roles`
(one-shot psql applying `.base44/dev-roles.sql`) → `web` (`next dev --port 3001`, published
on host port **3000**).

## Non-obvious bits

- Migrations create the group roles (`vantage_app`, `vantage_worker`, `vantage_auth`,
  `vantage_marketing`) as `NOLOGIN`. `.base44/dev-roles.sql` adds `<group>_login` logins and
  grants the group, so RLS stays real in dev instead of connecting as superuser.
- `DATABASE_DRIVER=pg` is required: the default Neon serverless driver cannot talk to a plain
  Postgres container.
- Local URLs use `?sslmode=disable`; the db helper only skips TLS for local hosts.
- `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` / `AUTH_TRUSTED_ORIGINS` must be the preview origin
  (`https://3000-$BASE44_PUBLIC_HOST_SUFFIX`) or sign-in rejects the origin.
- `next.config.ts` adds `allowedDevOrigins` from `BASE44_PUBLIC_HOST_SUFFIX` so dev assets/HMR
  work through the preview proxy.
- Platform secrets come from `/run/base44/app.env`; non-secret dev defaults from
  `.env.base44-defaults` (loaded first, so real secrets win).
- External integrations (Resend email OTP, TBA, Google OAuth, Stripe) degrade to
  `setup_required` states without keys — the marketing/auth pages work regardless.
- First admin (after a real email provider is set): `npx tsx scripts/bootstrap-platform-owner.ts`.

## Verify

`curl -s -o /dev/null -w '%{http_code}' localhost:3000/` → 200; logs via
`docker compose -f docker-compose.base44.yml logs web`.
