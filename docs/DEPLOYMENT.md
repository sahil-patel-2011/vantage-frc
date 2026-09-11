# Deployment runbook

> **Before you self-host:** the recommended way to use Vantage is the hosted version at
> **https://vantage-frc-web.vercel.app**. It is free, already set up end to end (database, sign-in,
> integrations, scheduled jobs), and needs nothing installed. This runbook is for teams that
> specifically want to run their own copy on their own accounts — start with the shorter
> [SELF_HOSTING.md](SELF_HOSTING.md) and come here for every variable and connector.

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
- **Preview Git deploys are off.** `git.deploymentEnabled` keeps only `main` (if a branch matches
  both `**` and `main`, the `true` rule wins). `ignoreCommand` (`node scripts/vercel-ignore-build.mjs`)
  is the fallback: exit 0 skip, exit 1 build. Do not call `deploy_to_vercel` from agents.
- There is no second `apps/web/vercel.json` any more. It was inert (the Root Directory is the repo root) and a cron added to it once looked scheduled while never firing; the root file is the only cron source.
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
`RATE_LIMIT_REDIS_URL/TOKEN` (otherwise per-instance in-memory rate limiting),
`DRIVE_OBJECT_*` (object storage for Vantage Drive — section 4a).

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
5. Send a test event from Stripe; expect `{"received":true}`. A missing or invalid signature → 400.
   **Missing `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` → 503, naming them** — those two used to be
   indistinguishable in the Stripe dashboard, which sent people off regenerating a signing secret that
   was never the problem. A failure after the signature verifies → 500, so Stripe retries.

Without Stripe env, checkout surfaces are setup_required — the site still runs, and
`/api/billing/checkout` answers 503 with the variable names rather than "Checkout unavailable".
See section 4b for the full connector table.

## 4. Resend (auth email)

`RESEND_API_KEY` + `AUTH_EMAIL_FROM` (e.g. `Vantage <access@yourdomain.com>` on a domain verified in
Resend) enable email OTP sign-in, email 2FA, and invite delivery. Until both are set **and** the app is
redeployed, email 2FA is not enforced and email delivery reports setup_required — this is a designed
degradation, not an error. `ENABLE_EMAIL_2FA_BYPASS` keeps 2FA off even with Resend configured; leave
it unset.

Two failure modes worth knowing before you debug a "missing" email:

- **The domain must be verified in Resend**, not just the key created. An unverified sending domain is
  accepted by the API and the message is dropped — nothing in the response says so.
- **Outside production nothing is delivered at any setting.** `createEmailProvider()` returns an
  in-memory local mailbox when `NODE_ENV !== "production"`; `/connectors` says so rather than reporting
  a healthy connector. See section 4b.

## 4a. Object storage for Vantage Drive (`DRIVE_OBJECT_*`)

Vantage Drive (`/files`) routes each upload to one of three homes: the hosted database, the team's own
paired storage node, or an S3-compatible object store. The database path is capped by Vercel's
request-body limit (4 MiB — see `apps/web/lib/storage-routing/caps.ts`) and the node path needs
hardware the team owns and exposes, so a team with neither has nowhere to put a 300 MB practice-match
video. These five variables give it one:

| Var | Example |
| --- | --- |
| `DRIVE_OBJECT_ENDPOINT` | `https://<project>.supabase.co/storage/v1/s3` or `https://<account>.r2.cloudflarestorage.com` |
| `DRIVE_OBJECT_BUCKET` | `vantage-drive` |
| `DRIVE_OBJECT_ACCESS_KEY` | S3 access key id |
| `DRIVE_OBJECT_SECRET_KEY` | S3 secret access key |
| `DRIVE_OBJECT_REGION` | `us-east-1` (R2 uses `auto`; Supabase uses the project's region) |

Notes:

- **All five or none.** Until every one is set, `POST /api/drive/upload/plan` reports object storage as
  `setup_required` and names the missing variables, and routing falls through to the existing
  node/database logic. Half-configured never half-works.
- The endpoint must be **https** — the browser PUTs directly to it from a secure page, so a plain-http
  endpoint is refused at configuration time rather than failing at the end of an upload.
- **Bytes never transit this deployment.** The server signs a presigned PUT (AWS SigV4, implemented in
  `apps/web/lib/storage-routing/sigv4.ts` with `node:crypto` — no AWS SDK dependency) and the browser
  uploads straight to the bucket. Downloads are presigned GETs the same way.
- **The bucket needs CORS.** Because the browser is the uploader, the bucket must allow `PUT` and `GET`
  from the app's origin, with `Content-Type` in the allowed headers. Without it the upload fails with an
  opaque network error; the UI says so explicitly rather than blaming the file.
- Addressing is **path-style** (`<endpoint>/<bucket>/<key>`), which both Supabase Storage and R2 accept
  and which needs no per-bucket DNS.
- Keys are `drive/<orgId>/<sha256>` — org-prefixed like `cad_document_versions.storage_key`, so the key
  itself carries tenancy, and content-addressed within an org so re-uploading identical bytes is free.
- The intent is to point this at **Supabase Storage** once that account exists. Identity and product
  data stay on Better Auth + `withRls` regardless — this is object storage only, never the Supabase Data
  API (see `docs/SUPABASE_CUTOVER.md`).

## 4b. Connectors: every variable, callback URL and provider permission

Vantage talks to ten outside services. Every one of them degrades to a named setup state rather than
an error, and **`/connectors`** (Settings → Connectors) is the page that shows all ten at once with the
exact callback URL to register, the variables that are missing, the permissions to grant, and working
Connect / Disconnect buttons. It reads the same catalog this table is generated from —
`apps/web/lib/connectors/catalog.ts` — so if the two ever disagree, the file is right and this table is
stale.

Two invariants hold across every connector, and they are worth stating because breaking either is what
made connectors feel broken before:

- **A callback URL is computed from `BETTER_AUTH_URL` alone, never from the credentials.** The admin who
  has not created the provider application yet is the only person who needs the URL — and cannot obtain
  a client id without pasting it in first. So the URL is readable with nothing configured.
- **"Connected" always means a real stored row**, never "the environment variable is present". A
  deployment with `GITHUB_OAUTH_CLIENT_ID` set has an OAuth application, not a linked repository.

Replace `https://<your-domain>` with `BETTER_AUTH_URL` exactly — a trailing slash or an `http://` host
is the most common cause of `redirect_uri_mismatch` an hour later.

| Connector | Variables | URL to register with the provider | Where you create the credential | Permissions / scopes to grant |
| --- | --- | --- | --- | --- |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Authorised redirect URI: `https://<your-domain>/api/auth/callback/google`. For `next dev`, also register `http://localhost:3001/api/auth/callback/google` and keep local `BETTER_AUTH_URL=http://localhost:3001`. `next dev` ignores a production URL copied by `vercel env pull` so Google does not callback to Vercel. | Google Cloud console → APIs & Services → Credentials → OAuth 2.0 Client IDs → **Web application** | `openid`, `email`, `profile` |
| GitHub | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` (optional `GITHUB_OAUTH_REDIRECT_URI`, `GITHUB_OAUTH_SCOPES`) | Authorization callback URL: `https://<your-domain>/api/github/oauth/callback` | github.com → Settings → Developer settings → OAuth Apps → New OAuth App | `read:user`, `repo` (never `workflow`; Vantage never pushes) |
| The Blue Alliance | `TBA_AUTH_KEY` (alias `TBA_API_KEY`) | **none** — TBA has no OAuth and needs no URL from us | thebluealliance.com → Account → Read API Keys | Read API v3 |
| Onshape | `ONSHAPE_OAUTH_CLIENT_ID`, `ONSHAPE_OAUTH_CLIENT_SECRET` (optional `ONSHAPE_OAUTH_REDIRECT_URI`, `ONSHAPE_OAUTH_SCOPES`) | Redirect URL: `https://<your-domain>/api/cad/onshape/oauth/callback` | dev-portal.onshape.com → OAuth applications | `OAuth2Read`, `OAuth2Write` |
| Discord | **none for webhooks.** `DISCORD_BOT_TOKEN` (+ `DISCORD_CLIENT_ID` for the invite link) only for bot posts | **none** | Webhook: Discord → Server Settings → Integrations → Webhooks. Bot: discord.com/developers/applications → your app → Bot | Send Messages, Embed Links, Read Message History |
| Slack | **none for outbound.** `SLACK_SIGNING_SECRET` (or a per-team secret saved on `/team/slack`) only for replies coming back | Request URL: `https://<your-domain>/api/integrations/slack/events` | api.slack.com/apps → your app → Incoming Webhooks, then Event Subscriptions (secret under Basic Information) | `incoming-webhook`, `chat:write`, `channels:history`; subscribe to `message.channels` |
| Email (Resend) | `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | **none** | resend.com → API Keys, **and** Domains → verify the sending domain | Sending access; the domain in `AUTH_EMAIL_FROM` must be verified |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (optional `DATABASE_BILLING_URL`) | Endpoint URL: `https://<your-domain>/api/stripe/webhook` | Secret key: dashboard.stripe.com → Developers → **API keys**. Signing secret: Developers → **Webhooks** → Add endpoint | Events `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed` |
| Team storage node | `DATABASE_CAD_RELAY_URL` (the `vantage_pairing` role; may point at `DATABASE_URL` until a dedicated role exists) | **none** — the node polls `/api/storage-node/pair/poll` | Run the storage-node agent on the team machine; it prints a pairing code | A pairing code approved by an owner or admin, at `/team/storage` |
| Fusion 360 relay | `FUSION_RELAY_SIGNING_SECRET`, `DATABASE_CAD_RELAY_URL` | **none** | Install the Vantage Fusion add-in on the laptop | A pairing code approved by an owner or admin, at `/cad/connections` |
| Free relay (Pi) | `DATABASE_CAD_RELAY_URL` (pairing pool), plus on the Pi: `FREE_RELAY_BASE_URL`, `FREE_RELAY_API_KEY`, `FREE_RELAY_MODEL` | **none** — the Pi polls `/api/relay/pair/poll` | Pair at `/team/relays`. Do not paste a Freebuff website cookie. | Owner/admin pairing code. Chat / agent / video roles. See `docs/FREEBUFF.md` |

## 4c. Desktop installers and auto-update

`GET /api/desktop/release` is public. It reads `latest.json` from GitHub Releases (`desktop-v*` tags).
When no release exists it returns 503 with an empty download set and an honest message — it never
invents a URL.

CI: `.github/workflows/desktop.yml` on tag `desktop-v*`. Windows job: NSIS + MSI + portable. macOS
job: universal DMG + zip. The release job attaches artifacts and writes `latest.json` with
`downloads.win_msi`, `win_nsis`, `mac_dmg`. macOS builds cannot run in this Linux image.

Unsigned until the owner sets signing env (`CSC_LINK`, `CSC_KEY_PASSWORD`, and for macOS `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). The NSIS license (`apps/desktop/build/UNSIGNED.txt`)
says the build is unsigned. Details: `docs/DESKTOP.md`.

Notes that cost time when they are missed:

- **Resend accepts the call and drops the message** when the domain in `AUTH_EMAIL_FROM` is not verified.
  A green API key is not proof that mail is arriving.
- **Outside production, email is never delivered at all.** `createEmailProvider()` returns an in-memory
  local mailbox when `NODE_ENV !== "production"`, whatever `RESEND_API_KEY` says. The status on
  `/connectors` states this explicitly rather than reporting a healthy connector.
- **Stripe's webhook answers 503, not 400, when its variables are missing**, and names them. A 400 is
  reserved for a payload we genuinely do not trust — and Stripe does not retry a 400, so a setup problem
  reported as one would silently drop the events that arrive while you fix it. A failure *after* the
  signature verifies is a 500, so Stripe retries rather than treating a lost subscription activation as
  delivered.
- **Slack's Request URL must be absolute.** Slack rejects a path. Outbound posting works with just a
  channel webhook and needs nothing from the deployment; only replies coming back need the signing
  secret and the Request URL.
- **Discord needs nothing from the deployment for the common case.** A channel webhook is pasted by the
  team on `/team/discord`. `DISCORD_BOT_TOKEN` is only for the bot path, which posts to a channel id
  instead of a webhook.
- **A revoked GitHub token reports "Token expired — reconnect"**, not "Not connected". `/api/github`
  with `action: "verify"` spends one call against the stored credential and records the result; a
  refused credential is told apart from a rate limit by `x-ratelimit-remaining`, because advising a
  reconnect on a rate limit would throw away a working token.
- **Pairing endpoints answer 503 for a missing `DATABASE_CAD_RELAY_URL`.** The caller is an agent on
  someone's shop computer, and a 400 tells it that *it* sent something wrong, so it stops.
- **A team-scoped connector never reads as Connected from environment alone.** GitHub, Discord, Slack and
  the storage node each need a row an owner or admin created; until then `/connectors` says "Ready to
  connect" or "Not connected", which are different states with different fixes.

## 5. Cron jobs and the CRON_SECRET

All eight cron routes live under `apps/web/app/api/cron/` and share one guard
(`assertCronAuthorized` in `apps/web/lib/reference/run-ingest.ts`): they accept
`Authorization: Bearer <CRON_SECRET>` **or** an `x-cron-secret: <CRON_SECRET>` header, return 503 when
`CRON_SECRET` is unset, and 401 on a wrong secret. Vercel Cron automatically sends the Bearer header
when `CRON_SECRET` is set on the project.

**Scheduled by Vercel (root `vercel.json` — the Hobby plan allows exactly two):**

| Path | Schedule (UTC) |
| --- | --- |
| `/api/cron/tba-sync?mode=event-day` | `0 14 * * *` |
| `/api/cron/tba-sync?mode=season` | `0 6 * * *` |

`?mode=season` is the daily catch-all. It is one Vercel cron but several jobs:
`runSeasonCronPiggybacks()` runs sponsor reminders, scheduled product releases,
the intel research sweep, and the new-member onboarding sequence, each wrapped so
one failing cannot fail TBA ingest. **Adding a job means adding it there, not
adding a fourth entry to a `crons` array.**

> Only the **root** `vercel.json` is read — the Root Directory is the repo root,
> which is why the former `apps/web/vercel.json` was inert and has been deleted. A cron added there once looked
> scheduled in the diff and never fires, which is worse than a deploy error
> because nothing complains. Member onboarding was added there once; that is why
> it rides the season sync now.

**Not scheduled — need an external ticker (or a Vercel plan with more crons):**

- `/api/cron/parent-digest` (weekly parent email digest; it was listed in the deleted `apps/web/vercel.json`, which
  is inert while the Root Directory is the repo root — decide: drop it there or upgrade the plan)
- `/api/cron/team-dream` (nightly team-memory consolidation; journal renders at Team → AI Memory)
- `/api/cron/team-performance-email`
- `/api/cron/sponsor-reminders`
- `/api/cron/grant-deadline-alerts`
- `/api/cron/research-sweep`
- `/api/cron/member-onboarding` — **already running daily**, as a piggyback on `?mode=season`; the
  route stays for `?orgId=` testing and for a Pro-plan ticker that wants its own schedule. It sends
  nothing to anyone who joined before the `member_onboarding` row in `email_feature_epochs`, and
  nothing at all to a member with no outstanding items.

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
