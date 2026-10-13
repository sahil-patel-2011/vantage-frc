# First task: joining a team actually works, by request or by team code

Paste everything below the line as the agent's first task (after the system prompt in
`SYSTEM_PROMPT.md`).

---

## Goal

A person who wants to be on an FRC team's Vantage gets on it, every time, in under a minute, in one
of two ways, and every edge case ends somewhere clear:

1. **Request to join.** They type the team number and ask; the team's owner or admins get the
   request, approve or decline it, and the requester finds out and lands on the team.
2. **Team code.** They type a short team code that any member can see in their settings, and they
   are on the team straight away as a student/scout.

Then prove it holds up for 100 teams using the app at the same time.

Follow your skills: `vantage-workflow` (loop), `vantage-code-review` (read first),
`vantage-gui-testing` (prove it in a browser), `vantage-ui-design`, `vantage-supabase`
(migrations), `vantage-production-gotchas` (prod and scale).

## What already exists (read it all before designing anything)

- **Join requests:** `request_workspace_access` (SQL; latest version in migration 0733),
  `workspace_access_requests` table, approval UI in `apps/web/app/team/team-admin-access.tsx` /
  `team-admin-client.tsx` (Team admin → people waiting), core logic in
  `packages/core/src/membership.ts` and `packages/core/src/onboarding.ts`, the onboarding team step
  and pending screen in `apps/web/app/onboarding/`, team-number copy in
  `apps/web/lib/onboarding/team-lookup.ts`.
- **Teams not on Vantage yet / nobody leads them:** team requests (`team_setup_requests`,
  `request_team_setup`, `review_team_setup_request`, platform-admin console at `/admin/teams`),
  team bans, one platform owner. All from migration 0733.
- **Team join codes today:** migration `0708_team_join_codes.sql` (6 digits, bcrypt hash plus an
  encrypted copy, managers only, database-backed attempt limits in `team_join_attempts`),
  `apps/web/lib/team/join-code.ts`, `join-code-flow.ts`, `apps/web/app/team/team-join-code.tsx`
  (the manager panel at Team admin → `#join-code`), public `/join-team`
  (`apps/web/app/join-team/join-team-client.tsx`, `apps/web/app/api/teams/join/route.ts`), browser
  test `tests/browser/team-join-code.spec.ts`, design note
  `docs/release/team-join-codes-2026-10-02.md`. A code currently needs team number + code + email
  and creates a 30-minute exact-email invitation that joins as scout or viewer.
- Settings list: `apps/web/lib/nav/settings-nav.ts` (the "Join code" row is owner/admin only
  today), `apps/web/components/settings-layout.tsx`.

Extend these. Do not build a second join system.

## Part 1: requests that actually go through

Walk the whole request path locally with real accounts and fix every break:

- New person → onboarding → types a team number that **exists and has an owner** → request sent →
  every owner/admin of that team sees it (notification + Team admin) → approve → requester's
  pending screen moves on by itself or on refresh → lands on that team's Home with the right role.
  Decline → requester sees why and can try another team.
- Team **not on Vantage yet** → team request to platform admins (0733) → approve → requester is
  owner. Others who asked for the same team are forwarded to that new owner.
- Team **exists but nobody leads it** → request also reaches platform admins.
- **Banned** team → clear message, nothing created.
- Requester already a member; requests twice; requests two teams; withdraws; owner approves on a
  phone; two admins approve at the same moment; requester's email unverified.
- Every message the requester sees says exactly what happens next and who decides.

## Part 2: team codes, decided and built

### Product decision (from the owner, with my recommendation; build this unless the code shows a better way)

Many teams will start with **one student trying Vantage first**, who becomes the team's owner,
then invites mentors who arrive after the team exists. Codes make that easy. Recommended design:

- **Format:** 7 characters from an unambiguous alphabet (A–Z and 2–9, without I, O, 0, 1, L), shown
  in two groups like `K7M-Q2PX`, accepted with or without the dash and in any case. The code alone
  identifies the team (no team number needed), so it must be unique among active codes.
- **Rotation:** a new code every day (midnight, America/Los_Angeles is fine as one global
  boundary; say so in the UI), and **yesterday's code keeps working for 24 hours** so a code read
  out last night still works this morning. Rotate lazily on first read or use after the boundary,
  inside one `SECURITY DEFINER` function with `FOR UPDATE`, so no cron is needed and two
  simultaneous readers cannot rotate twice. Owners/admins can **Rotate now** (if it leaked) and
  **Turn off** codes.
- **Who sees it:** **every member** of the team, read-only, under
  **Settings → This team → Team code**, with a Copy button and the line "Changes every day. Share
  it only with people on your team." Owners/admins also get Rotate now / Turn off there (and keep
  the Team admin panel working).
- **What it grants:** joins immediately as **student/scout**, never admin. Owners and admins get a
  "joined with the team code" notification and can remove or change roles from People. Mentors
  who join by code are promoted by the owner; the owner can also hand over ownership (exists).
  Offer an owner setting "Ask me before code joins take effect" (default off) only if it fits
  cleanly.
- **Where you enter it:** on the onboarding team step, next to "Request to join", a second option
  **"I have a team code"** with the input and, under it: "Ask a teammate. It's in
  Settings → This team → Team code." The same on `/join-team` and on the "no team yet" and pending
  screens.
- **Safety:** keep the database-backed attempt limits per person and per network; lock a network
  out of a team after repeated wrong codes; never return a code to non-members; never log codes;
  audit rotations. A code join must still require a verified email, the age gate and consent, the
  same as an invite.
- **Edge cases to handle and test:** the student owner leaves or graduates (ownership handover, or
  a platform admin reassigns; make that possible from `/admin/teams`); a mentor joins by code and
  needs admin (owner promotes); a code from a banned team; a code typed during the 24h overlap; a
  rotation while someone is mid-join; a person already on another team (they can be on more than
  one; the switcher must show both); a person on no team yet; codes turned off; a team with
  hundreds of members.

Migration: next free number (0734 unless something landed since; check). Keep 0708's tables if
you can extend them; migrate existing 6-digit codes gracefully (old codes keep working until the
first rotation, or say clearly that they changed).

## Part 3: 100 teams at once

Prove the join flows and the core app hold up for 100 teams × ~30 people, all different teams:

- Write a local seed script (e.g. `scripts/agent/seed-teams.mjs`) that creates N teams with owners,
  admins, students and scouting data in the **local** database, using `@example.test` emails.
- Write a small concurrent load script that signs in many local users and hits the busiest routes
  (`/api/me`, Home, scouting submit, join with code, request to join, team admin approvals). Report
  latency percentiles, errors, and database connections in use (`pg_stat_activity`).
- Check tenant isolation under load: no response for team A ever contains team B's rows.
- Review the TBA ingest and AI agent paths against `vantage-production-gotchas`: one shared TBA
  cache, never per-team or per-request TBA calls; AI runs metered per team, capped, isolated. Fix
  what you find, or list it with evidence if it is out of scope.

## Done means

- PRs merged with tests (unit + Postgres tests for the SQL functions + a browser test for code join
  and request approval), a migration file, and a paste-ready production SQL file for the owner.
- A walk-through recorded in the PR: each role, phone and desktop, screenshots of the request
  screens, the code in Settings, the code entry, the approval, and the landing page.
- Load-test numbers and the isolation check in the PR.
- A short report to the owner: what changed, what they need to run or approve (migration,
  deploy), and anything you recommend next.
- Do not deploy or touch the production database yourself.
