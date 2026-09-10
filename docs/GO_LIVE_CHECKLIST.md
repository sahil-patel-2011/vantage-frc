# Go-live checklist

Verified 2026-08-24 by tracing source end to end (not by browser clicks). Each journey below lists the
actual hops in code with file evidence, and an honest PASS/FAIL. Companion docs: `docs/DEPLOYMENT.md`
(how to deploy) and `npm run deploy:preflight` (env + migration inventory gate).

## Critical journeys (code-traced)

### 1. Sign-up → onboarding → consent recorded — PASS

- Access is closed: Better Auth (Google + email OTP) signs a user in at `/signin`
  (`apps/web/app/signin/page.tsx`); non-members land on the waitlist.
- `apps/web/proxy.ts` auto-protects every non-public route and redirects incomplete profiles to
  `/onboarding` (`onboardingRedirect`, proxy.ts:134).
- `POST /api/onboarding` (`apps/web/app/api/onboarding/route.ts`) requires `termsAccepted: z.literal(true)`
  **and** `privacyAccepted: z.literal(true)` in a `.strict()` schema, runs under `withRls`, and calls
  `completeOnboarding` (`packages/core/src/onboarding.ts:471`), which calls `recordLegalAcceptance`
  (onboarding.ts:560 → `packages/core/src/legal.ts:40`) writing `terms_accepted_at/terms_version/
  privacy_accepted_at/privacy_version` onto `profiles` at version `LEGAL_DOC_VERSION = 2026-09-09.1`.
- Rate-limited (30/10min) and served `cache-control: private, no-store`.

### 2. Admin creates team → owner invite → accept — PASS

- `POST /api/admin/organizations` (`apps/web/app/api/admin/organizations/route.ts`) gates on
  `assertPlatformAdmin` + `assertPlatformPrivilegeMfa`, then `createOrganizationAsPlatformAdmin`
  (`packages/core/src/membership.ts:40`, slug-validated).
- Owner/admin invites: `POST /api/organizations/invites` → `createOrganizationInvite` under
  `withRls({userId, orgId})`, exact-email, role-typed; resend/revoke supported.
- Accept: `POST /api/invites/accept` (`apps/web/app/api/invites/accept/route.ts`) peeks the invite,
  enforces the exact-email match with a 403, requires/records legal consent when owed, then
  `acceptOrganizationInvite` (SECURITY DEFINER path noted in code). Preview endpoint exists at
  `/api/invites/preview`.

### 3. Scout offline entry → sync → strategy read — PASS

- Offline outbox: `apps/web/lib/scout-offline.ts` posts batches to `/api/scouting/sync` with
  `resultsMode: "per-entry"` (line 475) and backoff (`lib/scouting/sync-backoff`).
- Server: `apps/web/app/api/scouting/sync/route.ts` supports both the legacy all-or-nothing shape and
  per-entry SAVEPOINT isolation (one bad entry can't wedge the batch); writes go through
  `ScoutingRepository.syncEntry` (`packages/scouting/src/repository.ts:174`) into
  `match_scout_entries` / `pit_scout_entries` + `scout_sync_receipts` (idempotent on clientId).
- Strategy reads the same table: `apps/web/lib/strategy/compute-strategy.ts` selects from
  `match_scout_entries` — the sync→strategy hop is one table, no copy step.

### 4. Pick list → alliance selection desk — PASS

- Desk compute (`apps/web/lib/alliance-selection-desk/compute-alliance-selection-desk.ts`) imports
  `ensurePickList` / `boardState` / `setBoardSlot` from `../picklist` (line 8), reads
  `alliance_selection_desk_sessions/_slots/_evidence/_exports` (migration `0418`), joins
  `team_event_metrics`, `teams_ref`, and live scouting counts.
- Route: `apps/web/app/api/alliance-selection-desk/route.ts` under `withRls` with a membership check;
  evidence attach validates the scout-entry ids belong to the org.
- Cross-links to picklist-collab verified in `alliance-selection-desk-related.ts` (+ its test).

### 5. Pre-match briefing compose — PASS

- `GET /api/briefing` (`apps/web/app/api/briefing/route.ts`) is a thin route over
  `computeBriefingView` (`apps/web/lib/briefing/compute-briefing.ts`) under `withRls`; accepts
  `matchKey` (and legacy `match`). Sections logic has colocated tests (`plan-sections.test.ts`).

### 6. Hours kiosk scan → totals — PASS

- `apps/web/app/api/hours/kiosk/route.ts`: scan action writes via `member_scan_codes` /
  `kiosk_scan_events` / `hour_logs`; auto-close policy (forgot-to-scan-out) computes credited hours from
  `hour_policies`. Honest degradation: if migration `0457_hours_kiosk_scan.sql` is unapplied it detects
  the missing tables (line 69) and returns "run migration 0457… then reload" instead of crashing.
- Totals: `apps/web/app/api/hours/route.ts` sums `hour_logs` per member against `hour_policies`
  (season-start window, travel-eligibility thresholds).

### 7. BYOK key save → adapter resolve → chat with provenance — PASS

- Save: `POST /api/organizations/ai-keys` checks `aiKeysEncryptionStatus()` (setup_required when no KMS),
  envelope-encrypts with `encryptSecret(apiKey, createKms())`, inserts into `org_llm_keys`
  (ciphertext + nonce + auth tag + encrypted DEK + kms key id).
- Resolve: `packages/agent/src/resolve-chat-adapter.ts` reads `org_llm_keys`, `decryptSecret`s, and
  `resolveOrgChatAdapterWithProvenance` (line 627) attaches provenance metadata.
- Chat: 12 routes use the resolver incl. `/api/agent`, `/api/agent/autonomous`, `/api/code`,
  `/api/writer`; usage is metered via `meteredAI` with `keySource` byo/local/platform/sponsored
  (`packages/billing/src/index.ts` — BYO bypasses credit caps, platform enforces the wallet lock).
- Production caveat: the local KMS refuses to init in production, so BYOK needs AWS KMS env (flagged by
  preflight and in DEPLOYMENT.md).

### 8. Bugbot plan → chunked scan → findings persist — PASS

- `POST /api/code` (`apps/web/app/api/code/route.ts`): `planGitHubBugbotScan` builds the plan
  server-side from the repo tree at a pinned SHA (`asCommitSha`), chunk files are fetched via
  `fetchGitHubScanBundle`, chunk coverage/skips computed per chunk (chunk 0 carries the whole-repo skip
  list), past-the-end chunks return an honest `empty` message.
- Persistence: `apps/web/lib/code/bugbot-store.ts` upserts `code_bugbot_findings`
  (seen_count increments on re-detection) and `code_bugbot_finding_dismissals`
  (migrations `0439/0440/0468`). Ultra flat-fee charge via `bugbotUltraChargeUsd`.

### 9. Dream cron → journal render — PASS (needs external ticker)

- `GET|POST /api/cron/team-dream` guarded by `assertCronAuthorized` (CRON_SECRET Bearer or
  `x-cron-secret`); `runTeamDream` (`apps/web/lib/dreaming/run-dream.ts`) writes `team_memories` and
  logs every attempt to `team_dream_runs` (line 671); UTC-Saturday weekly roll-up; response is counts
  only, never org content. Members can trigger their own org via `POST /api/dreams` (owner/admin auth).
- Journal renders in Team → AI Memory (`apps/web/app/team/ai-memory/ai-memory-client.tsx` reading
  `/api/dreams`).
- Deployment note: this route is NOT in the two Vercel Hobby crons — it only runs if the external
  ticker from DEPLOYMENT.md §5 is stood up. Route works; scheduling is an ops decision (blockers list).

### 10. Export CSV — PASS

- Table CSV: `POST /api/export/table` echoes client-built CSV back with
  `content-type: text/csv` + `Content-Disposition` so the browser/desktop shell downloads it
  (size-capped, filename-sanitized via `csvContentDisposition`).
- Team archive: `POST /api/exports` + `GET /api/exports/download?token=` →
  `downloadExport` from `@vantage/export-center` under `withRls`, zip with `private, no-store`.
  Requires `EXPORT_ENCRYPTION_KEY` in production (preflight WARNs when absent).

## Pre-flight gates

- [ ] `npm run deploy:preflight` — 0 FAIL rows against the production env
- [ ] `npm run typecheck` / `npm test` / `npm run lint` green on the deploy commit
- [ ] Migrations applied to production Postgres; re-run prints only `SKIP`
- [ ] Platform owner bootstrapped; `BOOTSTRAP_TOKEN` removed
- [ ] Stripe webhook test event returns `{"received":true}`
- [ ] Resend domain verified; a real OTP email arrives
- [ ] External cron ticker firing (check `team_dream_runs` rows the next morning)
- [ ] `/admin/integrations` (platform admin) shows no unexpected `error`/`degraded` rows — it aggregates
      config + already-persisted live signals for DB roles, Better Auth/Resend/Google, TBA/Statbotics/
      Nexus/FIRST, Stripe/KMS, VAPID/Twilio, GitHub/Slack/Discord, Onshape/Fusion relay, AI providers/
      bridge, Redis, storage, and cron freshness — without exposing any secret value
- [ ] Function duration decided: the deploy plan allows the 300 s `maxDuration` the bridged AI
      routes declare, **or** `VANTAGE_BRIDGE_MAX_WAIT_MS` is set below the plan's cap (blocker 8)

## Honest blockers (open at time of writing)

1. **DB migrations are unapplied to any live production Postgres.** The runner and 325 SQL files exist
   and are idempotent per filename, but no production database has been stood up and migrated. This is
   the first real go-live task.
2. **RLS is untested against live Postgres.** Unit tests are credential-free by design; the RLS
   integration tests need a real Postgres with the migration roles (`vantage_app`/`vantage_worker`).
   Tenancy isolation must be smoke-tested on the production host (two orgs, cross-read attempts) before
   inviting real teams.
3. **~24 duplicate migration number prefixes** (0050, 0067, 0070, 0096, 0105×3, 0106, 0109, 0111, 0127,
   0150, 0153×3, 0155, 0162×3, 0163×3, 0166×3, 0171, 0172, 0177, 0184, 0219, 0258, 0259, 0264, 0265) and
   many numbering gaps. The runner tolerates both (full-filename keying, lexicographic order), but a
   fresh-database apply has never been proven end to end — run it against a scratch Neon branch first.
   `npm run deploy:preflight` prints the current list.
4. **Legal review outstanding.** `LEGAL_DOC_VERSION = 2026-09-09.1` discloses AI-training use of
   AI-feature activity — a reversal of earlier no-training language. Counsel should review the Terms and
   Privacy documents (and the youth/COPPA implications of an FRC-student audience) before real sign-ups
   record acceptance of them.
5. **Cron scheduling decision.** Hobby allows two crons; seven cron routes exist. Root `vercel.json`
   schedules the two TBA syncs only; the former `apps/web/vercel.json` (inert at repo-root Root Directory, now deleted) listed
   three. Decide: external ticker (DEPLOYMENT.md §5), plan upgrade, or accept that dreams/digests/
   reminders don't run — (the stale `apps/web/vercel.json` has since been deleted).
6. **BYOK requires real KMS.** Without `AWS_KMS_KEY_ID` + credentials, saving team AI keys fails in
   production (local KMS intentionally refuses). Either provision KMS before launch or launch with
   platform-key AI only and say so.
7. **Email 2FA off until Resend is configured** — closed-membership invite emails also depend on it.
8. **The bridged AI routes now declare a 300 s function duration.** `/api/season-report`, `/api/cad`,
   `/api/code`, `/api/ai-insights`, `/api/match-debrief`, `/api/grants/assist`, `/api/grants/writing`,
   `/api/learning/predictions`, `/api/agent-narration/explain` and `/api/agent/autonomous` set
   `export const maxDuration = 300` so a heavy job served by an AI-bridge device on coverage
   `everything` can finish. **300 s is only honored on a plan whose maximum Node function duration
   reaches it** — that ceiling belongs to the hosting plan, not to this repo, so confirm it for the
   plan this project deploys on. On a plan capped at 60 s the operator MUST set
   `VANTAGE_BRIDGE_MAX_WAIT_MS=50000`: without it the platform kills the function before the bridge
   answers and before the fall-through to the team's own keys runs, and the caller gets a 504
   instead of a slower answer on their own keys. Details: `docs/AI_BRIDGE.md` → *Function duration*.

- [ ] Set the Free plan hosted allowance to match the catalog: Admin → Models → sponsored pool, monthly_allowance_usd = 3 (the catalog advertises a $3 budget-class allowance on Free; until this is set, Free orgs get whatever the platform default row says).
