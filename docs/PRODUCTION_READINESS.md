# Production readiness

*The checklist Vantage is held to before and after every release. Each line says how it was checked.
Last verified 2026-09-25 against `main` and the live deployment. Supersedes the go-live list in
`GO_LIVE_CHECKLIST.md`, which describes the state before production existed.*

Legend: **[x]** verified · **[~]** works with a known, accepted limit · **[ ]** open.

## 1. Release gates (every push to `main`)

- [x] `npm run typecheck` — every workspace, 0 errors.
- [x] `npm run lint` — 0 errors.
- [x] `npm test` — ~10,900 unit tests, 0 failures, no credentials needed.
- [x] Browser suite (`npm run test:browser` against the dev server with the local seed) — 373 passed, 0 failed.
- [x] `npm run build` — clean production build.
- [x] Vercel deploy status `success` for the pushed commit, and the live `/`, `/pricing`, `/signin` answer 200.
- [x] Pushes are batched (Vercel builds are metered); only `main` deploys (`vercel.json` → `git.deploymentEnabled`).

## 2. Data and tenancy

- [x] Every request reads and writes through `withRls({ userId, orgId })`; the worker role is lint-blocked from request code.
- [x] Every org-scoped table has `org_id … ON DELETE CASCADE`, RLS enabled and policies on `is_org_member` / `has_org_role`.
- [x] SQL is parameterised with explicit casts; no string-built queries.
- [x] Production migrations applied through **0693**; a re-run prints only `SKIP`. Each production batch is applied only after the owner's explicit yes.
- [~] Backups: Neon keeps point-in-time history for the project's retention window. A restore drill (branch from a past point, read a team's rows) is an operator task, done once per season.
- [x] Team deletion cascades through `org_id`; exports are encrypted (`EXPORT_ENCRYPTION_KEY`, falling back to the auth secret).

## 3. Sign-in and access

- [x] Closed membership: the platform admin creates each team and its owner; owners and admins invite exact emails; everyone else lands on the waitlist.
- [x] Email codes: six digits, hashed at rest, five minutes, five tries per code, then a new code is needed. Codes are only sent to addresses that could sign in, and the endpoint answers the same either way.
- [x] Sign-in request limits are sized for a classroom on one school network (40 code requests a minute per address), because guessing is capped per code, not per network.
- [x] Google sign-in: one OAuth client accepts the main host, the Scouting host and `localhost:3001`; the callback origin is the main host and the Scouting host signs in through a one-time handoff. *Google sign-in cannot complete on a local dev port other than 3001; test it on the deployment.*
- [x] Incomplete profiles are held at `/onboarding`; `proxy.ts` protects every non-public route; platform-admin pages need a `platform_admins` row.
- [x] Session cookies are HttpOnly, SameSite=Lax and Secure in production; Better Auth's origin/CSRF checks stay on.

## 4. Security headers and surface

- [x] Live headers checked with `curl -I`: HSTS (1 year, subdomains), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, strict referrer policy, a restrictive `Permissions-Policy`.
- [x] Public API routes are an explicit allow-list in `proxy.ts` (auth, waitlist, invite preview, handoff, token-gated TV feeds, health, unsubscribe, cron).
- [x] Secrets live only in Vercel's encrypted environment; team AI keys are envelope-encrypted with `VANTAGE_KMS_MASTER_KEY`.
- [x] The repository is public: no secrets, no private team data, no internal hosting detail in shipped copy.

## 5. Reliability and monitoring

- [x] `GET /api/health` → `{ ok, database }`, 200 or 503, nothing else. Point an uptime monitor at it.
- [x] Server errors: `apps/web/instrumentation.ts` logs one JSON line per error (route, method, name, trimmed message, digest; never headers, query strings or bodies) to Vercel's runtime logs, and posts it to `ERROR_WEBHOOK_URL` (Slack or Discord) when that is set.
- [x] App-level error pages: `error.tsx`, `global-error.tsx`, `not-found.tsx`; product routes return `setup_required` / `empty` states instead of crashing when data or integrations are missing.
- [x] Offline: scouting entries queue on the device and sync with per-entry isolation and back-off; Home and key pages serve a cached copy with an "offline" banner.
- [~] Scheduled jobs: the two Vercel crons refuse to run while `CRON_SECRET` is empty, which is the owner's choice. Event data refreshes when a page loads it (`hydrateOrgActiveEvent`) and from Team data → Refresh now. Setting `CRON_SECRET` turns the daily syncs on.
- [~] Rate limits are per server instance (in memory) until `RATE_LIMIT_REDIS_URL` is set; acceptable at current traffic.

## 6. AI

- [x] Every model call is metered through the billing path (`meteredAI`, `feature=…`), which locks the org's billing row, sums the ledger and enforces caps before appending usage.
- [x] Teams run AI on their own key (OpenAI, Anthropic, OpenRouter, Google and others, saved encrypted), or on the free providers the platform configures (Groq, Cerebras, Mistral, Cohere). The owner picks the provider under Team → AI keys.
- [x] AI agents only act through the team's own permissions (RLS) and are optional: every screen works with AI off.
- [x] Model-training choice is per team under Team → AI keys → Model training.

## 7. Product quality

- [x] No invented numbers: features skip rows without real data and show a setup or empty state. Marketing frames carry no figures.
- [x] Engines, all from real inputs: season ratings and scouting blended into win chance with per-match uncertainty; event OPR from official alliance scores (time-decayed, with auto/teleop/endgame split); seed odds from 10,000 simulated finishes of the remaining quals; pick lists with z-scored, weighted metrics.
- [x] Every form's submit button is a real submit (enforced by a unit test).
- [~] Persona walkthroughs (six agents, desktop and phone) — latest completed round 76–85; target 90+ for every persona, rounds continue until met.
- [x] Phone layouts checked at 390×844; tap targets 44px on touch; text contrast from design tokens.

## 8. Operator setup still open

- [ ] Point an uptime monitor at `https://vantagefrc.vercel.app/api/health`.
- [ ] Set `ERROR_WEBHOOK_URL` to a Slack or Discord webhook to be pinged on server errors.
- [ ] Decide on `CRON_SECRET` (daily event syncs) — currently off by choice.
- [ ] Owner connects the team data copy from Admin → Integrations (script redeploy, then Connect).
- [ ] Legal review of Terms and Privacy for a student audience before wide launch.
