# Deployment runbook

How to take this repo to a real Vercel + Neon (or Supabase Postgres host) production deployment.
Everything below is verified against code in this repo — file paths are cited so you can re-check.
Run `npm run deploy:preflight` before every deploy; it prints a PASS/WARN/FAIL table for env
completeness and the migration-file inventory (`scripts/deploy-preflight.mjs`).

## 1. Vercel project

The only shipping web deployment is `apps/web` (`apps/marketing` is a redirect shim).

- **Root Directory: the repo root.** The repo-root `vercel.json` carries the monorepo build:
  `installCommand: npm install --legacy-peer-deps`, `buildCommand: npm run build --workspace=@vantage/web`,
  `outputDirectory: apps/web/.next`. Keep the Root Directory at the repo root so this file is the one
  Vercel reads.
- There is a second `apps/web/vercel.json`. It only matters if the project's Root Directory is set to
  `apps/web` — in that case its **three** crons exceed the Hobby two-cron ceiling and the deploy's cron
  config is rejected/truncated. Known discrepancy; see the cron section below.
- Node: `engines.node >= 22` (root `package.json`).
- Production build is credential-free by design — no DB or auth env is needed to *build*. Auth constructs
  lazily; product routes render `setup_required`/empty states when env is absent.

### Environment variables (Vercel → Settings → Environment Variables)

The authoritative annotated catalog is `.env.example`; the machine-checkable version is
`scripts/deploy-preflight.mjs`. Summary:

**Required (deploy is broken without these):**

| Var | Breaks without it |
| --- | --- |
| `DATABASE_URL` | every product route (pooled RLS request role `vantage_app`) |
| `DATABASE_ADMIN_URL` | migrations + cron/worker jobs (`vantage_worker`) — must be **unpooled** |
| `DATABASE_AUTH_URL` | Better Auth session store — sign-in |
| `BETTER_AUTH_SECRET` | session signing |
| `BETTER_AUTH_URL` | OAuth callbacks / trusted origin (`https://vantage-frc-web.vercel.app` or custom domain) |
| `NEXT_PUBLIC_APP_URL` | absolute links (invites, calendar feeds, shares) |
| `NEXT_PUBLIC_SITE_URL` | metadataBase / OG / sitemap / robots |
| `CRON_SECRET` | every `/api/cron/*` route returns 503 |

**Strongly recommended (real feature degrades to setup_required):** `RESEND_API_KEY` + `AUTH_EMAIL_FROM`
(auth emails / email 2FA), `GOOGLE_CLIENT_ID/SECRET` (Google sign-in), `TBA_AUTH_KEY` (all event/match
reference data), `MFA_ENCRYPTION_KEY`, `MFA_RECOVERY_PEPPER`, `EXPORT_ENCRYPTION_KEY`,
`AWS_KMS_KEY_ID` + AWS credentials (BYOK — **the local dev KMS refuses to init in production**, so BYOK
key saves fail without real KMS), `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`,
`MARKETING_DATABASE_URL` (waitlist otherwise falls back to an in-memory dev store),
`VAPID_PUBLIC_KEY/PRIVATE_KEY` (web push), `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` (platform AI),
`RATE_LIMIT_REDIS_URL/TOKEN` (otherwise per-instance in-memory rate limiting).

**Never set in production:** `E2E_AUTH_FIXTURE`, `DEV_KMS_MASTER_KEY`, `DEV_OTP_SECRET`. Remove
`BOOTSTRAP_TOKEN` after first boot (section 6). `ENABLE_EMAIL_2FA_BYPASS` is emergency-only.

If you use the Vercel Neon/Supabase integration, it may inject `DATABASE_URL`/`DATABASE_URL_UNPOOLED`
or `POSTGRES_URL`/`POSTGRES_URL_NON_POOLING`. The app accepts those shapes as fallbacks; prefer mapping
the canonical names with `node scripts/map-neon-env.mjs` or `node scripts/map-supabase-env.mjs`.
Ignore any injected `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — identity is Better
Auth and product data never uses the Supabase Data API.

## 2. Neon (Postgres) and migrations

Migrations are plain SQL under `packages/db/migrations/`, applied by `scripts/run-migrations.mjs`,
which records each **filename** in a `schema_migrations` table and applies files in lexicographic
order, one transaction each. On failure it stops, logs to `scripts/migration-failures.log`, and exits 1.

1. Create the Neon project (or Supabase Postgres host — see `docs/SUPABASE_CUTOVER.md` for the
   role bootstrap `packages/db/supabase/00_roles.sql` and the session-pooler port rules).
2. The roles (`vantage_app`, `vantage_worker`, RLS helpers) are created by the early migrations
   (`0000_foundation.sql`, `0001_roles_and_rls.sql`) — you just need a superuser-ish admin URL to run them.
3. Locally, put the **unpooled** admin URL in `.env.migrate.local` (or `.env.production.local`) as
   `DATABASE_ADMIN_URL`. Shell/CI variables override those optional files; use
   `npm run db:migrate -- --migration-env-file <path>` to load one explicit file.
4. Run: `npm run db:migrate`. This is the authoritative apply command and invokes
   `scripts/run-migrations.mjs`; `npm run db:generate` only generates Drizzle artifacts. Expect a
   long `APPLY`/`OK` stream on first run.
5. Re-run to verify it prints only `SKIP` lines (idempotent).
6. Check `npm run deploy:preflight` — it warns for the exact 24 frozen historical
   duplicate-number prefixes and fails any new or expanded collision. Duplicates *do* apply (the
   runner keys on the full filename), but same-number files apply in alphabetical-slug order; do not
   add new files reusing an existing number.

`npm run test:db:integration` exercises a destructive fresh-schema apply/reapply plus two-org RLS
checks only when `TEST_DATABASE_ADMIN_URL` is set. For safety it accepts only a local host and a
dedicated database name containing a `test` or `ci` segment; GitHub Actions provisions `vantage_ci`.

There is no automatic migration on deploy — running the migration script against production Neon is a
deliberate manual step (see the Go-Live checklist blockers).

## 3. Stripe

Webhook route: `POST /api/stripe/webhook` (`apps/web/app/api/stripe/webhook/route.ts`). It verifies the
`stripe-signature` header via `constructStripeEvent` and processes inside a transaction on the billing
pool (`DATABASE_BILLING_URL`, falling back to `DATABASE_URL` — `packages/db/src/billing.ts`).

1. Set `STRIPE_SECRET_KEY` in Vercel.
2. In the Stripe dashboard, add a webhook endpoint: `https://<your-domain>/api/stripe/webhook`,
   subscribing at minimum to checkout/session and invoice/subscription events used by
   `processStripeEvent` in `packages/billing`.
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.
4. Optionally provision a least-privilege `vantage_billing` role and set `DATABASE_BILLING_URL`.
5. Send a test event from Stripe; expect `{"received":true}`. Missing/invalid signature → 400.

Without Stripe env, checkout surfaces are setup_required — the site still runs.

## 4. Resend (auth email)

`RESEND_API_KEY` + `AUTH_EMAIL_FROM` (e.g. `Vantage <access@yourdomain.com>` on a domain verified in
Resend) enable email OTP sign-in, email 2FA, and invite delivery. Until both are set **and** the app is
redeployed, email 2FA is not enforced and email delivery reports setup_required — this is a designed
degradation, not an error. `ENABLE_EMAIL_2FA_BYPASS` keeps 2FA off even with Resend configured; leave
it unset.

## 5. Cron jobs and the CRON_SECRET

All seven cron routes live under `apps/web/app/api/cron/` and share one guard
(`assertCronAuthorized` in `apps/web/lib/reference/run-ingest.ts`): they accept
`Authorization: Bearer <CRON_SECRET>` **or** an `x-cron-secret: <CRON_SECRET>` header, return 503 when
`CRON_SECRET` is unset, and 401 on a wrong secret. Vercel Cron automatically sends the Bearer header
when `CRON_SECRET` is set on the project.

**Scheduled by Vercel (root `vercel.json` — the Hobby plan allows exactly two):**

| Path | Schedule (UTC) |
| --- | --- |
| `/api/cron/tba-sync?mode=event-day` | `0 14 * * *` |
| `/api/cron/tba-sync?mode=season` | `0 6 * * *` |

**Not scheduled — need an external ticker (or a Vercel plan with more crons):**

- `/api/cron/parent-digest` (weekly parent email digest; listed in `apps/web/vercel.json` but that file
  is inert while the Root Directory is the repo root — decide: drop it there or upgrade the plan)
- `/api/cron/team-dream` (nightly team-memory consolidation; journal renders at Team → AI Memory)
- `/api/cron/team-performance-email`
- `/api/cron/sponsor-reminders`
- `/api/cron/grant-deadline-alerts`
- `/api/cron/research-sweep`

External ticker options (pick one):

1. **GitHub Actions** in a private repo (secrets: `CRON_SECRET`, `APP_URL`):

   ```yaml
   on:
     schedule:
       - cron: "30 8 * * *"   # nightly dreams, 08:30 UTC
   jobs:
     tick:
       runs-on: ubuntu-latest
       steps:
         - run: |
             curl -fsS -X POST "$APP_URL/api/cron/team-dream" \
               -H "Authorization: Bearer $CRON_SECRET"
   ```

   Add one step per route; weekly jobs (parent-digest was intended `0 21 * * 0`) get their own schedule.
2. **cron-job.org / any HTTP scheduler**: URL = the route, custom header `x-cron-secret: <CRON_SECRET>`
   (use the header field so the secret is not in the URL).

Note `/api/cron/team-dream` sets `maxDuration = 300` — on Vercel Hobby the function cap is lower, so if
a full-fleet dream run times out, tick it per-org with `?orgId=<uuid>` or run it on a paid plan.

## 6. First boot: platform-admin bootstrap

Access is closed — a platform admin must exist before any team can be provisioned. Two equivalent
paths (both need migrations applied first):

**A. HTTP bootstrap** (`apps/web/app/api/admin/bootstrap-owner/route.ts`):

1. Set in Vercel: `PLATFORM_OWNER_EMAIL`, `PLATFORM_OWNER_PASSWORD`, `PLATFORM_OWNER_NAME`,
   `BOOTSTRAP_TOKEN` (a long random string). Redeploy.
2. `curl -X POST https://<your-domain>/api/admin/bootstrap-owner -H "x-bootstrap-token: <BOOTSTRAP_TOKEN>"`
3. Sign in with email + password at `/signin`.
4. **Rotate `PLATFORM_OWNER_PASSWORD` and delete `BOOTSTRAP_TOKEN` from Vercel**, then redeploy.
   The route 404s when `BOOTSTRAP_TOKEN` is unset — that is the armed/disarmed switch.

**B. Local script**: `npx tsx scripts/bootstrap-platform-owner.ts` with the same `PLATFORM_OWNER_*`
vars pointed at the production DB.

After bootstrap: `/admin` (gated by a `platform_admins` row) → create the first organization with its
owner email → the owner signs in, completes onboarding (Terms + Privacy consent is recorded), and
invites members by exact email. Everyone else lands on the waitlist.

## 7. Deploy order (summary)

1. `npm run deploy:preflight` (env file or Vercel env pulled via `vercel env pull`).
2. Apply migrations to production Postgres (section 2) — verify with a `SKIP`-only re-run.
3. Set Vercel env (section 1), including `CRON_SECRET`; deploy.
4. Bootstrap the platform owner (section 6); disarm the bootstrap token.
5. Configure Stripe webhook (section 3) and Resend domain (section 4).
6. Stand up the external cron ticker (section 5).
7. Walk `docs/GO_LIVE_CHECKLIST.md` end to end and clear its blockers list.
