---
name: vantage-production-gotchas
description: >-
  What works on localhost but behaves differently (or breaks) in production on Vercel + Supabase:
  Google sign-in origins, email codes, cookies, serverless instances, the database pooler, TBA
  limits, AI metering, deploy gating, and what changes when 100 teams use the app at once. Use
  before shipping anything that touches auth, email, external APIs, caching, background work,
  limits or performance, and before asking for a deploy.
---

# Production is not localhost

## Sign-in and sessions

- **Google sign-in.** The Google OAuth client only allows the redirect
  `https://vantage-frc-web.vercel.app/api/auth/callback/google`. Sign-in started on any other
  production host is sent there and carried back by Better Auth's oAuthProxy
  (`resolveGoogleOAuthCallbackOrigin` in `packages/core/src/access-policy.ts`). Adding a domain
  means: register its callback in Google Cloud Console, add it to the trusted origins, then set
  `GOOGLE_OAUTH_CALLBACK_ORIGIN`. Locally `next dev` uses its own `localhost:3001` callback, which
  only works if localhost is registered on a dev OAuth client. Test sign-in locally with email
  codes, and say in your report that Google sign-in was not exercised.
- **Auth origin.** `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` must be the public https origin in
  production. Requests from origins not in `trustedOrigins` are refused (CSRF protection), so a new
  domain or preview URL fails sign-in until it is allowed.
- **Email codes.** Locally codes are deterministic (`scripts/dev-otp.mjs`) and nothing is
  emailed. In production they are random, sent by Resend (`RESEND_API_KEY`, `AUTH_EMAIL_FROM` on a
  verified domain), last 30 minutes, and a new one can be sent once a minute. Without Resend the
  app must say "email isn't set up", not pretend it sent.
- **Second step.** An email-code or password sign-in also passes email 2FA; Google counts as the
  second factor. Do not turn on Better Auth's cookie cache: the 2FA step updates the session row.
- **Cookies** are `Secure` in production (https only) and the session cookie name differs from
  local. A flow that reads cookies by name, or sets one without `Secure`/`SameSite`, can pass
  locally and fail live.
- `E2E_AUTH_FIXTURE` and the local KMS refuse to run when `NODE_ENV=production`. Never weaken that.

## Serverless (Vercel functions)

- Many instances run at once and any of them can be cold. Module-level `Map`s and globals are
  per instance and vanish. Use them only as best-effort caches (like the 30s onboarding-gate
  cache), never for correctness: rate limits, attempt counters, locks, queues and "already sent"
  flags belong in Postgres.
- Dev uses in-memory stores for the waitlist and rate limits; production uses the database. Test
  limits against the database path.
- Functions time out. Long work (imports, AI runs, TBA backfills) goes to the existing workflow
  and queue workers, not a request.
- `vercel.json` has `"crons": []`. Scheduled work piggybacks on the existing season-sync job;
  do not add cron jobs or paid features.

## Database

- Requests use the Supabase transaction pooler (see `vantage-supabase`). No session state outside
  one `withRls` transaction; no external calls while holding a client; short transactions.
- A migration must be applied to production **before** the code that needs it is deployed.
  Code should degrade to a setup-required state if it is missing, not crash.

## External data and AI

- **The Blue Alliance is a shared, rate-limited cache.** Read the reference tables first. Only the
  one ingest worker calls TBA, with `If-None-Match`/ETag and backoff. Never call TBA (or
  Statbotics) from a page request, per team, or in parallel loops. `TBA_AUTH_KEY` may be absent:
  show "connect The Blue Alliance".
- **AI is metered.** Every model call goes through `meteredAI` with a `feature=`, which enforces the
  team's cap and logs usage. BYO keys are envelope-encrypted; never log or return them.

## Deploying

- Git pushes, including `main`, never build. `scripts/vercel-ignore-build.mjs` builds only the
  commit whose full SHA is in the Vercel variable `VANTAGE_RELEASE_SHA`. A release = set that
  variable to the merge commit's SHA, then create the production deployment for that SHA.
- Deploys, env-var changes and production migrations need the owner's explicit OK each time.
  Never decrypt or print Vercel env values. Touch only the `vantage-frc-web` project. No paid
  add-ons. GitHub Actions are disabled for the repo; never enable or dispatch them.
- After a deploy: open the live site, sign in, run the changed flow once, and check
  `/api/health` and the runtime logs for errors.

## 100 teams at once

Design and review every change as if 100 teams, each with 20–40 people, are using it during a
competition weekend on venue Wi-Fi:

- **Queries per page:** count them. A Home with 12 widgets × 3 queries is 36 per load. Batch into
  one route or one query where you can; cache shared reference data.
- **Indexes:** every org-scoped table needs an index leading with `org_id` for the queries you
  add. Check with `EXPLAIN` on realistic row counts (seed thousands of rows locally).
- **No per-team loops in a request.** Anything that walks all teams is a worker job.
- **Bounded results:** paginate or `LIMIT` every list; never `SELECT *` an unbounded table.
- **Concurrency:** two people approving the same request, double-submits, retries after a
  timeout. Use unique constraints, `ON CONFLICT`, `FOR UPDATE` and idempotent writes.
- **Limits:** per-user and per-network attempt limits for anything guessable (codes, invites),
  stored in Postgres so every instance sees them.
- **Offline and flaky networks:** scouting saves on the device and syncs later; every screen
  survives a failed request with a clear message and a retry.
- **Isolation:** test with at least two teams so a bug that shows team A's rows to team B is caught
  locally, not by a user.
