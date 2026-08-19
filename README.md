# Vantage

Vantage is a multi-tenant operations platform for FRC teams. This repository contains the phase-one
foundation plus competition-ready scouting, Intel/Research, closed membership, configurable AI routing,
pricing controls, and durable private/team agent context.

## Repository map

- `apps/web` — the single public deployment: marketing, legal/pricing/waitlist, Better Auth, and every
  session-protected product route.
- `apps/desktop` — Windows Electron shell around the hosted web app (`docs/DESKTOP.md`).
- `apps/marketing` — retirement shim only. Its Vercel project permanently redirects every path to `apps/web`.
- `packages/db` — typed Drizzle schema, request-scoped RLS client, worker-only admin client, and SQL migrations.
- `packages/core` — auth, tenancy, active-context, invite, notification, and admin-audit helpers.
- `packages/billing` — serialized credit enforcement, append-only usage ledger, BYO-key envelope encryption,
  AWS KMS adapter/local KMS substitute, and Stripe event handling contract.
- `packages/reference` — TBA/Statbotics clients, adapter-neutral sync jobs, worker-only idempotent writers,
  authenticated read repositories, and credential-free fixtures/tests.
- `packages/intel-research` — active-event-prioritized lookup, analytics, source-linked research, crawl
  budgets, scheduled/on-demand runners, and deterministic local providers.
- `packages/agent` — configurable model router, bounded context selection, private/team memory repository,
  and a deterministic local chat adapter.

## Local clone path

On this machine the preferred checkout folder is `C:\Users\sahil\Cursor Projects\Vantage`
(short brand name). Older names (`Vantage FRC Robotics AIO APP`, `…-business-portal`) referred to
the same `vantage-frc` GitHub remote; business features live under `apps/web` `/business`, not a
second app. See `archive/business-portal-legacy/README.md`.

## Local setup

1. Install Node 22+ and run `npm install`.
2. Copy `.env.example` to `.env.local`. Do not commit it.
3. The unified app runs on `http://localhost:3001` with `npm run dev`; waitlist persistence and rate limiting
   use in-memory development stores when cloud credentials are absent.
4. For product auth and SQL integration, create Postgres databases/roles and run all migration files in
   numeric order as the schema owner. Set `DATABASE_URL` to an RLS-enforced app-role URL,
   `DATABASE_ADMIN_URL` to the worker role, `DATABASE_AUTH_URL` to the identity-only role, and
   `MARKETING_DATABASE_URL` to the least-privilege marketing role.
5. Public routes include `/`, `/desktop`, `/pricing`, `/privacy`, and `/terms`. Product routes redirect to
   `/signin?next=...` and successful authentication continues to the requested route or `/dashboard`.

Product sign-in uses Google when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured. Numeric email
OTP uses Better Auth’s database-backed hashed verification records (five-minute expiry, one-time consumption,
attempt limits, and request/verify rate limits). Production delivery uses Resend via `RESEND_API_KEY` and
`AUTH_EMAIL_FROM`. Development uses a deterministic in-memory mailbox and never needs email credentials.
There is no public organization creation or team-number join path: a platform admin provisions each team and
seeds a verified owner, then owners/admins invite exact email addresses. Waitlist-only policy still applies
to Google: only the platform owner, existing users, or emails with a pending invite may authenticate;
everyone else is pointed at the waitlist.

**Platform admins:** Only emails/users with a `platform_admins` row may open Global Team Manager (`/admin`),
platform connectors/models/commercial settings, or cross-org admin APIs. Access is not self-serve — add a DB
row (or re-run bootstrap for `PLATFORM_OWNER_EMAIL`) using the admin database role. Org Team Admin under
`/team` is separate and stays limited to that org's owner/admin. See `SECURITY_OPERATIONS.md`.

**Database:** Auth and product data use Postgres (`DATABASE_AUTH_URL` / `DATABASE_URL` as `vantage_app`,
`DATABASE_ADMIN_URL` as `vantage_worker`). Production today is **Neon**; a **Supabase Postgres host** cutover
(same Better Auth + `withRls` org isolation, Data API off) is in `docs/SUPABASE_CUTOVER.md`. Do not put
`anon` / `service_role` keys in the web app. Resend is only the email transport for OTP / forgot-password /
default email 2FA; it does not replace Google OAuth or Postgres.

**TBA shared cache:** Platform-global TBA/Statbotics reference tables in Neon are the shared cache. One ingest
worker uses `TBA_AUTH_KEY` (or an encrypted platform credential) with ETag/`If-None-Match`, in-flight dedupe,
and polite backoff. Org dashboards and widgets read Neon first — never open parallel unrestricted TBA polls.
Org/admin BYO TBA keys under Admin → Data connectors / Team → Live data are controlled fallbacks only; they
do not start a second high-rate poller. Steps to create a key: https://www.thebluealliance.com/account → Read
API v3 key → paste once → Test connection (full key never shown again).

**First-login onboarding:** After password/Google (and email 2FA when enforced), incomplete profiles are gated
to `/onboarding` until `onboarding_completed_at` is set. DOB/gender are private (self + platform admin).

### Resend (email OTP / default email 2FA / password reset)

Google OAuth does **not** need Resend. After password or Google, Vantage defaults to **email OTP as second
factor** when Resend is configured. Email OTP and forgot-password stay unavailable until both env vars are set
on the Vercel project (`vantage-frc-web`), then redeploy:

1. Create a Resend account and API key at [resend.com](https://resend.com).
2. Verify a sending domain (or use Resend’s onboarding sender for testing).
3. In Vercel → Project → Settings → Environment Variables (Production):
   - `RESEND_API_KEY` = your Resend API key (`re_…`)
   - `AUTH_EMAIL_FROM` = a verified From address, e.g. `Vantage <access@yourdomain.com>`
   - Optional emergency only: `ENABLE_EMAIL_2FA_BYPASS=true` (default unset/off)
4. Redeploy. Confirm `/api/auth/status` reports `"emailOtpAvailable": true` and `"email2faEnforced": true`.

Until those are set, email 2FA is honestly not enforced; Google/password still work. Sign-in shows why.


### Google Cloud Console (production)

1. Create an OAuth client (Web application) in Google Cloud Console.
2. Authorized JavaScript origins:
   - `https://vantage-frc-web.vercel.app`
3. Authorized redirect URIs (exact):
   - `https://vantage-frc-web.vercel.app/api/auth/callback/google`
4. Paste the Client ID and Client Secret into Vercel production env as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, then redeploy. Until those are set, `/signin` shows **Continue with Google** as
   Coming soon.

Local development: also add `http://localhost:3001` as an origin and
`http://localhost:3001/api/auth/callback/google` as a redirect URI. Keep `BETTER_AUTH_URL` matching the app
origin.

### GitHub robot-code context (optional OAuth)

Org owners/admins link a robot-code repo in **Team admin → GitHub** (`/team?orgId=…#github-connection`).
An encrypted **PAT works with no server OAuth env**. For one-click OAuth, set
`GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` on Vercel (callback
`https://vantage-frc-web.vercel.app/api/github/oauth/callback`). Full checklist:
[`docs/GITHUB_CONNECTION.md`](docs/GITHUB_CONNECTION.md). Migration `0112_github_context.sql`.

## Deployment

The canonical production origin is **https://vantage-frc-web.vercel.app**. Configure the Vercel project root
as `apps/web` (with the repository workspace available), set `BETTER_AUTH_URL` to that exact HTTPS origin, and
attach the existing private Git repository. `apps/marketing` must either be retired or deployed once with its
permanent redirect configuration so historical Vercel URLs converge on the canonical origin.

Production requires `DATABASE_AUTH_URL`, a strong `BETTER_AUTH_SECRET`, `MARKETING_DATABASE_URL`, and the
credentials for each explicitly enabled integration. Never enable `E2E_AUTH_FIXTURE` in production; the code
also refuses that fixture whenever `NODE_ENV=production`.

The local key service is development-only and refuses to initialize in production. Production BYO key
encryption requires `AWS_KMS_KEY_ID` plus normal AWS workload credentials. Stripe processing requires its
secret and webhook signing secret. Plausible and Redis rate limiting are optional locally.

## Global reference ingest

Jobs (queue-provider neutral via `createProductionReferenceJobs()`):

- `reference.sync-season` — full year events → teams/matches/OPRs/rankings + Statbotics
- `reference.sync-event-day` — incremental refresh for events in the ±1 day window and org-subscribed active events

HTTP entry points (require `CRON_SECRET` Bearer / `x-cron-secret`):

- `GET|POST /api/cron/tba-sync?mode=event-day` — Vercel Hobby cron once daily at 14:00 UTC (`0 14 * * *` in `vercel.json`). Call this more often from Pro or an external ticker during event weekends.
- `GET|POST /api/cron/tba-sync?mode=season` — Vercel Hobby cron once daily at 06:00 UTC. Piggybacks sponsor reminders, scheduled product releases, and `runScheduledResearchSweep()`.
- `GET|POST /api/cron/research-sweep` — same research sweep, for Pro/extra crons (not in the Hobby two-cron `vercel.json`).
- `POST /api/cron/tba-sync` with `{ "eventKey": "2026miket" }` — force one event

Hobby is capped at two daily crons. Do not add a third path to `vercel.json` until the Vercel plan allows it. Team admins can still press **Sync now** on Admin → Live Data / Team live data for the active event.

Platform admins can also press **Sync now** on Admin → Live Data (`/api/admin/data-connectors` action `sync`).

Validators: TBA `If-None-Match` / `If-Modified-Since` persisted in `sync_cursors` (including a progress `cursor` per season pass). Keys resolve as encrypted platform credential → `TBA_AUTH_KEY` / `TBA_API_KEY` env → org BYO fallbacks via `GlobalTbaCoordinator`. Health lands in `data_source_health`. Apps read freshness from `tba_cache_freshness` / `matches_ref`, not raw cursors.

Production ingest requires a TBA key (env or encrypted) and `DATABASE_ADMIN_URL`. Statbotics has no key; its default 350 ms minimum interval and four-attempt exponential backoff can be tuned with the documented environment variables.

## Intel, research, models, and memory

`runScheduledResearchSweep()` is worker-only. Season TBA cron piggybacks it daily; Pro can also hit `/api/cron/research-sweep`. It creates shared jobs only while the current
`season_windows` row is active and only for teams found at organizations’ active events. Crawl budgets bound
teams, queries, and results. On-demand research bypasses the season gate but runs through `meteredAI` with
`feature=research`. Search adapters preserve source URL/date/confidence and deduplicate canonical URL +
content hash; snippets stay qualitative and never become hard metrics.

The model catalog seeds display names only. Provider endpoint model IDs, prices, capabilities, enabled state,
plan eligibility, routing weight, and included allowances must be configured by a platform admin. An enabled
model without a provider model ID is never routed. Fable 5 is always PAYG-only. Provider keys are envelope
encrypted and are never returned by APIs. Stripe checkout remains inactive until both Stripe credentials and
an admin-configured Price ID exist. Launch pricing defaults debit managed usage at provider list rates
(1.0×; 1 Usage Credit = $1 API) with hard cut-offs after included allowances; numbers stay in the admin
catalog for future entitlement versions.

Private memories are user-owned RLS rows and bounded before injection. Team memory is disabled by default.
Only messages written in a visibly team-shared channel, or a private message explicitly promoted by its
author, may create team memory. Enabling team memory never reads existing private chats. Context usage records
the exact memory/module source references used for each response.

## Safety boundaries

- Every request transaction uses `SET LOCAL app.user_id` and optional `app.org_id`; pooled identity cannot leak.
- Request code is lint-blocked from importing `@vantage/db/admin`.
- Org tables use RLS. Membership insertion is closed to platform seeding or the atomic
  `accept_org_invite()` path. Acceptance requires an unexpired single-use hash, exact verified email match,
  and a row lock. Invite resend/revoke/expiry and provisioning actions are audited.
- AI calls lock `org_billing`, sum the ledger for the active period, enforce grants/caps, invoke the provider,
  and append usage before releasing the lock. There is no denormalized credit counter.
- Waitlist rows never create product users, organizations, memberships, subscriptions, or product consent.
- Analytics accepts only three fixed event names and no arbitrary properties or contact values.
- Admin changes use append-only `admin_actions`; invite tokens are stored as SHA-256 hashes.
- Global reference tables have authenticated read-only RLS policies; only `vantage_worker` receives write
  grants, and sync cursors are not visible to the app role.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Database RLS integration tests require a running Postgres instance provisioned with the migration roles and
are intentionally separate from credential-free unit/build verification.
