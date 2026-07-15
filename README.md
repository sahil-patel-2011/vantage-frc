# Vantage

Vantage is a multi-tenant operations platform for FRC teams. This repository contains the phase-one
foundation plus competition-ready scouting, Intel/Research, closed membership, configurable AI routing,
pricing controls, and durable private/team agent context.

## Repository map

- `apps/web` — the single public deployment: marketing, legal/pricing/waitlist, Better Auth, and every
  session-protected product route.
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

## Local setup

1. Install Node 22+ and run `npm install`.
2. Copy `.env.example` to `.env.local`. Do not commit it.
3. The unified app runs on `http://localhost:3001` with `npm run dev`; waitlist persistence and rate limiting
   use in-memory development stores when cloud credentials are absent.
4. For product auth and SQL integration, create Postgres databases/roles and run all migration files in
   numeric order as the schema owner. Set `DATABASE_URL` to an RLS-enforced app-role URL,
   `DATABASE_ADMIN_URL` to the worker role, `DATABASE_AUTH_URL` to the identity-only role, and
   `MARKETING_DATABASE_URL` to the least-privilege marketing role.
5. Public routes are `/`, `/pricing`, `/privacy`, and `/terms`. Product routes redirect to
   `/signin?next=...` and successful authentication continues to the requested route or `/dashboard`.

Product sign-in uses Google when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured. Numeric email
OTP uses Better Auth’s database-backed hashed verification records (five-minute expiry, one-time consumption,
attempt limits, and request/verify rate limits). Production delivery uses Resend via `RESEND_API_KEY` and
`AUTH_EMAIL_FROM`. Development uses a deterministic in-memory mailbox and never needs email credentials.
There is no public organization creation or team-number join path: a platform admin provisions each team and
seeds a verified owner, then owners/admins invite exact email addresses.

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

The `reference.sync-season` job is queue-provider neutral: call
`createProductionReferenceJobs().syncSeason.run({ year })` from the existing scheduled-job adapter. It sends
TBA `If-None-Match`/`If-Modified-Since` validators persisted in `sync_cursors`, spaces Statbotics requests,
retries only rate-limit/transient failures, and idempotently upserts through the worker-only `dbAdmin` role.
Schedule the active season regularly and historical seasons less often.

Production ingest requires `TBA_AUTH_KEY` and `DATABASE_ADMIN_URL`. Statbotics has no key; its default
350 ms minimum interval and four-attempt exponential backoff can be tuned with the documented environment
variables. Request code reads reference rows through `ReferenceReadRepository` using the `PoolClient` passed
by `withRls()`. It cannot import the privileged writer or production worker. Unit tests use local API fixtures
and injected fetch/sleep functions, so neither a database nor live upstream credentials are needed.

## Intel, research, models, and memory

`runScheduledResearchSweep()` is worker-only. It creates shared jobs only while the current
`season_windows` row is active and only for teams found at organizations’ active events. Crawl budgets bound
teams, queries, and results. On-demand research bypasses the season gate but runs through `meteredAI` with
`feature=research`. Search adapters preserve source URL/date/confidence and deduplicate canonical URL +
content hash; snippets stay qualitative and never become hard metrics.

The model catalog seeds display names only. Provider endpoint model IDs, prices, capabilities, enabled state,
plan eligibility, routing weight, and included allowances must be configured by a platform admin. An enabled
model without a provider model ID is never routed. Fable 5 is always PAYG-only. Provider keys are envelope
encrypted and are never returned by APIs. Stripe checkout remains inactive until both Stripe credentials and
an admin-configured Price ID exist.

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
