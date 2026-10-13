---
name: vantage-workflow
description: >-
  The autonomous working loop for any change to Vantage: read and review the existing code first,
  plan, change, then prove it with typecheck, tests, lint and a real GUI walk-through before
  opening a PR. Use at the start of every coding task in this repo, and again before every push.
---

# Working on Vantage: the loop

Vantage is a live multi-tenant app used by FRC teams. A change that "should work" is not done.
A change is done when you have **seen it work** in a browser, the checks pass, and you have
re-read your own diff looking for what would break.

Work autonomously. Do not stop to ask about things the code, the docs or a sensible default can
answer. Do stop and ask before anything outward-facing or hard to undo (see "Stop and ask").

## 0. Before touching anything

1. `git fetch origin main && git log --oneline -8 origin/main` — other agents work here too. Never
   build on a stale branch; start each task from fresh `origin/main` on a new `claude/<slug>` branch.
2. Read `CLAUDE.md`, then the docs for the area (`docs/README.md` indexes them,
   `docs/FEATURE_MAP.md` says where each UI feature lives).
3. **Find what already exists before writing anything new.** Grep for the feature's nouns
   (`rg -n "join code|joinCode|join_code"`), its route (`apps/web/app/<feature>`), its API
   (`apps/web/app/api/<feature>`), its lib (`apps/web/lib/<feature>`), its migrations
   (`rg -l <table> packages/db/migrations`). Most features have a half you can extend. Duplicating
   one is the most common way agents break this repo.
4. Read the code you will change **and its callers and tests**, not just the function. Note the
   conventions in that file (naming, comment density, error copy) and match them.

Use the `vantage-code-review` skill for the full pre-change review checklist.

## 1. Plan in the open

Write a short task list (TaskCreate) before coding: the change, the migration if any, the tests,
the GUI checks, the PR. Keep it current. One task in progress at a time.

## 2. Change

- Keep each change minimal and in the style of the surrounding code.
- Data access: `withRls({ userId, orgId }, client => …)` with parameterized SQL (`$1::uuid`).
  Never import `@vantage/db/admin` from request code. Never string-concat SQL.
- New tables/columns: a new append-only migration with the next free number
  (`ls packages/db/migrations | tail -3`). Follow `0024_competition_operations.sql`: `org_id`,
  RLS on, policies via `is_org_member` / `has_org_role`, grants to `vantage_app` and
  `vantage_worker`. Org-scoped tables must pass `install_view_only_guards()` (see 0715).
- Never invent numbers, demo data or placeholder metrics. Empty → an honest empty/setup state.
- Missing env/integration → a clear "connect X" state, never a crash.

## 3. Prove it (every time, in this order)

```sh
npm run typecheck --workspace=@vantage/web      # or the package you touched
npx eslint <changed files>
npx vitest run <changed dirs>                    # then the full `npx vitest run` before the PR
```

Then **use the app** with the `vantage-gui-testing` skill: sign in as the right role, do the
task the way a student/mentor would, on phone (390px) and desktop (1280px), and screenshot it.
Read the screenshots. Check the console and network for errors and 5xx. Try the unhappy paths:
wrong input, empty data, no team, a member without permission, two tabs, a reload mid-flow.

If anything is off, fix it and go round the loop again. Do not report a step you skipped as done.

## 4. Self-review before pushing

Run `git diff origin/main...` and read every line as a hostile reviewer:

- Could this leak another team's data? (Every query scoped by RLS? Any `SECURITY DEFINER`
  function checking the caller itself?)
- What happens with 100 teams using it at once? (Queries per page, N+1, missing index on
  `org_id`, unbounded lists, per-request work that should be cached.)
- What only fails in production? (See `vantage-production-gotchas`.)
- Did I stage anything I did not mean to? (`git status`; never `git add -A` from the repo root
  without reading the list — generated files and other agents' work live here.)
- Copy: plain words, sentence case, says what to do next.

## 5. Ship

- Commit with a message that says what changed for users and why. Push `claude/<slug>`.
- Open a **draft** PR with a Summary / Changes / Testing body that states exactly what you ran
  and saw (and what you did not test). Mark ready, squash-merge with the full 40-char head SHA.
- Merging to `main` does **not** deploy (the Vercel ignore step only builds the commit named in
  `VANTAGE_RELEASE_SHA`). Deploys and production database changes need the owner's go-ahead.

## Stop and ask (never do these on your own)

- Deploying to Vercel, changing Vercel env vars, or anything that costs money.
- Applying a migration to the production Supabase database.
- Deleting or rewriting production data; force-pushing someone else's branch.
- Enabling or dispatching GitHub Actions (disabled for the whole repo on purpose).
- Anything that emails, notifies or messages real users.

## Keep going

After a task lands, look for the next most valuable thing in the same area (a broken edge case
you noticed, a confusing screen, a missing test) and either do it or list it for the owner. End
with a short report: what shipped (PR links), what you verified and how, what is left and why.
