# Nightly team memory consolidation ("dreaming")

Once a night, Vantage folds each team's last 24 hours of **real** activity into
one compact team memory so agent surfaces (team-scope chat context via
`AgentRepository.retrieveContext`) start tomorrow already knowing what happened
today.

## What it does

For every org with **team memory enabled** (`team_memory_settings.enabled`),
the worker:

1. Gathers a bounded digest of the last 24h with parameterized SQL and hard
   `LIMIT`s — `to_regclass` guards skip any table that does not exist yet:
   - team chat messages posted (`org_messages`: count + up to 15 recent
     author-name/120-char excerpts)
   - scouting entries (`match_scout_entries` / `pit_scout_entries`, counted by
     event)
   - decisions logged (`decision_records`)
   - build tasks and team to-dos completed (`build_tasks.done_at`,
     `team_todos.completed_at`)
   - calendar events that occurred (`subteam_calendar_events`)
   - safety incidents and pit repairs opened or resolved (`incident_reports`,
     `pit_repair_triage_reports`)
   - CAD agent jobs run (`cad_jobs`)
   - shop hours logged (`hour_logs`: closed sessions only — total hours plus a
     per-member breakdown; an open clock-in is not yet time worked)
   - "call your shot" calls (`learning_predictions`: calls, skips, and the hit
     rate over **graded** calls only — zero graded calls reports no rate)
   - match results for the team at its active event (`org_active_context.
     active_event_key` + `organizations.team_number` → `matches_ref`, filtered
     to results posted in the window; a match whose score has not posted is
     recorded as `unknown`, never guessed)
   - bug reports filed by the team (`bug_reports`)
   - funding deadlines that crossed into the **14-day** window that day
     (`grant_opportunities.deadline`, plus watch-listed
     `grant_calendar_opportunities.closes_on`). This is an equality test on
     `day + 14`, so a deadline is mentioned on exactly one night instead of
     nagging for fourteen.
2. Asks the org's own chat adapter (`resolveOrgChatAdapter` — org BYOK keys,
   member keys, local connectors, or the sponsored/free pool) to write a short
   recap: *what happened, what changed, open threads, what tomorrow-you should
   know*. The call is metered through `meteredAI` (`feature=team_dream`,
   attributed to the org's owner) with a modest output cap.
3. Stores **one** `team_memories` row per org per day (`source='dream'`,
   `expires_at` honoring the org's `retention_days`). Re-running the same day
   replaces that day's memory (delete + insert, tracked by the run ledger).
4. Records every attempt in `team_dream_runs` (`UNIQUE(org_id, day, kind)`):
   `status` ∈ `ok` / `no_activity` / `no_ai_fallback` / `error`, `kind` ∈
   `daily` / `weekly`, plus token counts, an error class, and a
   `source_counts` jsonb snapshot of what fed the entry — never content.

## Weekly roll-up

On **Saturday** (UTC), after the night's own run, each org also gets a week
summary filed under the same day with `kind='weekly'`.

- It reads the week's **daily dream rows** (`team_dream_runs` joined to their
  `team_memories` row, `day` in the seven-day window ending Saturday). It never
  re-reads raw activity tables, so the week can only ever repeat what the
  nights already recorded.
- Fewer than **3** recorded days in the window → the week is skipped with
  `status='no_activity'` and nothing is written. A thin week gets no summary.
- Daily rows the team's retention window has already aged out are excluded, so
  a roll-up can never quietly extend an expired recap's life.
- The AI call runs through `meteredAI` with `feature=team_dream_week`; the
  no-AI fallback stitches the week's recaps together verbatim under a header
  that says no model wrote it.
- The stored memory is one more `source='dream'` row with importance `0.7`
  (daily rows are `0.6`), so when the per-prompt token budget forces a trim the
  week summary is the row that survives.

## Grounding rules (non-negotiable)

- **Real rows only.** The digest is built exclusively from rows the team
  actually wrote. A day with no activity writes **no memory at all** — the run
  is recorded as `no_activity`.
- **Never invent.** The model prompt lists the recorded facts and instructs:
  anything not listed did not happen; sections without supporting facts must
  say "Nothing recorded."
- **No-AI fallback.** If no adapter resolves (no keys configured, decrypt
  failure, billing cap, HTTP failure — any failure at all), the same facts are
  stored as a deterministic structured plain-text digest
  (`status='no_ai_fallback'`). No AI, no invented prose — ever.

## Scheduling

The route is `GET|POST /api/cron/team-dream`, authorized exactly like the
other crons (`Authorization: Bearer $CRON_SECRET` or `x-cron-secret`).

**Vercel Hobby only allows two crons**, and this repo already spends both on
TBA sync (event-day + season, see `vercel.json`). Do **not** displace those.
Instead trigger dreaming from any always-on machine's crontab, e.g. nightly at
04:15 UTC:

```cron
15 4 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/team-dream
```

On Vercel Pro (or any external ticker) you can call it directly on whatever
nightly schedule you like. Re-runs on the same UTC day are safe: the day's
memory is replaced, and `team_dream_runs` upserts on `(org_id, day)`.

For a single org (testing):

```sh
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/cron/team-dream?orgId=<uuid>"
```

The response is counts only —
`{processed, ok, noActivity, fallback, errors, weeklyProcessed, weeklyOk,
weeklySkipped, weeklyErrors}` — never org content. The `weekly*` counters are
zero on the six non-Saturday nights.

## The Team journal (AI → Memory)

Dreams are not invisible: `/ai?tab=memory` (also `/team/ai-memory`) renders the
ledger as a dated journal.

- `GET /api/dreams?orgId=&before=&days=` — org-scoped through `withRls`, reads
  `team_dream_runs` LEFT JOINed to the `team_memories` row each run wrote.
  Entries come back newest-first, paged **a whole day at a time** (Saturday
  carries two rows, and a cursor that split them would drop one silently). Pass
  the returned `nextCursor` back as `before` to page further into the season.
- Each entry shows the day, the recap body, and chips for the sources that fed
  it (`N messages`, `N scout entries`, `N tasks done`, …) read straight from
  `source_counts`. A source that recorded nothing gets **no chip** — never a
  zero.
- `no_activity` / `no_ai_fallback` / `error` days render their honest status
  line instead of prose. Two or more consecutive failing **daily** runs raise an
  error-streak banner naming the recorded `error_class` and what to check (key
  configured? budget cap? memory still enabled?).
- An entry whose memory has expired or been disabled shows that it is no longer
  injected rather than continuing to display text that is out of play.
- **Retention is stated on the surface**: "entries older than N days expire",
  where N is the team's own `team_memory_settings.retention_days` — the same
  number the policy form below it edits.
- `POST /api/dreams {orgId}` — the "Run now for today" button. It requires an
  authenticated **owner/admin of that org**, deliberately *not* the
  `CRON_SECRET`, which stays a machine-only credential. Team memory must be on,
  and a five-minute cooldown keeps a hand off a button that spends the team's
  own AI credits. The verified org id is the only thing handed to the sweep.

## Retention

Dream memories are written with `expires_at = day + team_memory_settings.
retention_days`, so they age out exactly like promoted memories: once expired,
`AgentRepository.retrieveContext` stops injecting them, and the journal marks
the entry as no longer in play. The **run ledger** row is not deleted — a
team can still see that a night ran, and what fed it, after the text itself has
expired. Lowering the retention window does not retro-expire rows already
written; it applies to every run after the change.

## Privacy

Digests never leave the org's own boundary: the consolidated memory is a
normal `team_memories` row for that `org_id`, behind the same RLS as every
promoted team memory, and surfaces only in that org's team-scope agent
context. The `team_dream_runs` ledger that members can read holds status and
token counts, not text. The AI call goes to the org's **own** configured
provider (their BYOK/member key), through the standard metered billing path.
