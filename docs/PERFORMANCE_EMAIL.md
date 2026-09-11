# Daily team performance email

*For team admins and contributors: the weekly performance email. Last updated 2026-08-24.*

One email per member on days the team actually has performance data: how the
team performed today, tomorrow's schedule, and up to three "do better"
pointers — every line grounded in real cached data. On days with nothing real
to say, **nothing is sent**.

## What it is

- **Worker**: `apps/web/lib/performance-email/run-performance-email.ts`, admin
  pool (`vantage_worker`), mirroring `run-sponsor-reminders.ts` / `run-dream.ts`.
- **Pure digest assembly**: `apps/web/lib/performance-email/compute-performance-email.ts`
  (unit-tested; no DB, no network).
- **Cron route**: `GET|POST /api/cron/team-performance-email` — `CRON_SECRET`
  bearer or `x-cron-secret` header (same helper as `tba-sync`). `?orgId=<uuid>`
  runs a single org for testing. The response is **counts only** — never member
  emails or org content.
- **Email path**: `sendPerformanceDigestEmail` in
  `packages/core/src/email-notifications.ts` — the standard opt-in email
  pipeline (Resend in production, local mailbox in dev), plain text plus a
  simple HTML body, with the existing unsubscribe footer appended to both.
- **Send log**: `performance_email_log` (migration `0450`), one row per
  `(org_id, user_id, day)` with `UNIQUE` on that triple. The worker **claims
  the row before sending** (`ON CONFLICT DO NOTHING`), so cron re-runs and
  concurrent runs can never double-send. Statuses: `sent`, `skipped_pref`,
  `failed`.

## Grounding rules (the honesty rule, applied to email)

1. **No-data days send nothing.** An org is enumerated only when the UTC day
   has scored matches involving the team (cached TBA `matches_ref`) or org
   scouting entries. No filler, no "quiet day" emails, no log rows.
2. **Every fact comes from a real row**: match results and score breakdowns
   from `matches_ref`, rank/record from the `team_event_metrics` cache
   (TBA/Statbotics), scouting coverage from the org's own
   `match_scout_entries` / `pit_scout_entries`.
3. **Pointers are deterministic.** "Your last two losses were decided by
   endgame points" is emitted only when the score breakdowns literally show an
   endgame deficit ≥ the final margin. Same for auto gaps, penalty-decided
   losses, close losses, and scouting-coverage gaps. Missing breakdowns mean
   fewer pointers, never guessed ones. At most three ship.
4. **No fabricated movement.** Rank is reported as the current cached value
   with its source; there is no rank-history snapshot, so "up/down N places"
   is never claimed.
5. **AI paragraph is optional and grounded.** When the org's own chat adapter
   resolves (BYOK / member keys / sponsored pool), one short paragraph is
   generated through `meteredAI` (`feature="performance_digest"`, attributed to
   the org owner) from **only** the deterministic digest facts, with explicit
   no-invention instructions. Any failure — no key, billing cap, HTTP error —
   silently falls back to the deterministic body. TBA is never polled by this
   worker; it reads the Neon cache only.

## Default-on, per-member opt-out

- The email category is `performance_digest`
  (`user_email_preferences.performance_digest`, **`NOT NULL DEFAULT true`** —
  migration `0450` backfills existing rows, and the worker ensures a prefs row
  exists for members who never touched preferences).
- **Why default on**: this is the one email whose entire content is the team's
  own competition day — the exact days members are least likely to be at a
  screen configuring opt-ins. Because no-data days send nothing, the default
  costs quiet-season members zero emails.
- **Opt-out paths** (all pre-existing mechanisms):
  - every email carries the standard footer: unsubscribe from this category,
    unsubscribe from all Vantage emails, and a manage-preferences link;
  - `/notifications/preferences` → "Daily performance digest" toggle
    (saved via `PUT /api/account`);
  - token unsubscribe is honored server-side by `apply_email_unsubscribe`
    (`category='performance_digest'`, included in `'all'`).
- Skipped members get a `skipped_pref` log row — the run is auditable without
  re-checking prefs.

## Scheduling guidance (the UTC compromise)

The worker buckets "today" by **UTC calendar day** at call time and previews
matches in the following 24 UTC hours, so schedule it **late in the UTC day,
23:00–23:45 UTC**:

- 23:00 UTC = 6–8 PM across US time zones — evening, after a typical
  competition day ends, before teams plan the next morning.
- For European events 23:00 UTC is late night; the email is waiting at
  breakfast. That is the compromise: one UTC-evening send favors the
  US-heavy FRC calendar without per-org timezone machinery. If per-region
  timing ever matters, run the cron more than once with region-filtered
  `?orgId=` calls — the `performance_email_log` claim makes extra invocations
  safe (each member still gets at most one email per day).
- Vercel Hobby allows only two crons (already used by `tba-sync`); trigger
  this route from an external ticker with the `CRON_SECRET` bearer, like
  `/api/cron/team-dream`:

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<deployment>/api/cron/team-performance-email
```

Order it **after** the day's last `tba-sync` event-day run so the day's final
scores are in the cache.

## Verifying locally

```
npx vitest run apps/web/lib/performance-email/compute-performance-email.test.ts
curl -H "x-cron-secret: $CRON_SECRET" \
  "http://localhost:3001/api/cron/team-performance-email?orgId=<org-uuid>"
```

In development the email lands in the in-memory `localFreeformMailbox`
(`packages/core/src/email.ts`); production requires `RESEND_API_KEY` +
`AUTH_EMAIL_FROM`, otherwise sends record `failed` with a setup reason —
never a crash.
