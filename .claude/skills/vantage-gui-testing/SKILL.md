---
name: vantage-gui-testing
description: >-
  Prove a Vantage change works by using it: stand up the local database and dev server, sign in as
  real roles with dev-only codes, click through the flow at phone and desktop size, screenshot it,
  and read the screenshots. Use after every UI or API change, before every PR, and whenever someone
  asks "does it work".
---

# Test it by using it

Unit tests prove functions. They do not prove that a scout can join a team on a phone. Every
change that touches a screen or an API a screen calls gets walked through in a real browser.

## 1. The local stack (cloud container)

The container has Postgres 16 and Chromium. Never point tests at production and never start a
database on the owner's laptop.

```sh
pg_ctlcluster 16 main start                        # local Postgres on :5432
runuser -u postgres -- psql -d vantage -c 'select 1'   # DB "vantage" with every migration
```

If the database does not exist yet: create the roles the migrations expect (`vantage_app`,
`vantage_worker`, `vantage_auth`, `vantage_billing`, `vantage_display`, `vantage_marketing`,
`vantage_alliance_board`, each with a `*_login` user), create the DB, then
`DATABASE_ADMIN_URL=postgres://…/vantage npm run db:migrate`. Apply any new migration you wrote
the same way and re-run it once more to prove it is idempotent.

Start the app against it (keep secrets in a 0600 env file, never in the repo or the chat):

```sh
set -a; . ~/local.env; set +a        # DATABASE_URL, DATABASE_AUTH_URL, DATABASE_ADMIN_URL,
                                     # BETTER_AUTH_SECRET, … pointing at local Postgres
export BETTER_AUTH_URL=http://localhost:3001 NEXT_PUBLIC_APP_URL=http://localhost:3001 \
       AUTH_TRUSTED_ORIGINS=http://localhost:3001 NODE_ENV=development
cd apps/web && npx next dev --port 3001      # run it in the background
```

- Changes in `packages/*` (core, db) are **not** hot-reloaded: restart the dev server.
- `node scripts/dev-otp.mjs <email>` prints the sign-in code the local server accepts
  (dev only; production codes are random and emailed).
- Seed what you need with SQL against the local DB (a team, an owner, a scout, an event). Use
  `@example.test` emails. Write down the accounts you made in your report.

## 2. Walk the flow

```sh
node scripts/agent/ui-check.mjs --email owner@example.test --out /tmp/shots \
  --view phone,desktop /dashboard "/team?tab=people" /settings
```

It signs in, saves the session, screenshots each page at 390px and 1280px (add `--dark`), and
prints console errors, 5xx responses, text under 11px, tap targets under 40px on phone,
sideways scrolling and words set in monospace. **Then open and read every screenshot.**

For a flow (not just a page) write a short Playwright script in your scratch folder: open the
page, fill the form, press the button, wait, screenshot, assert the outcome in the DB. Patterns:

- Sign in: fill `input[type=email]`, press Enter, type the code from `dev-otp.mjs`.
- Read `page.on("console")`, `page.on("pageerror")`, `page.on("response")` (status ≥ 500).
- Measure layout with `getBoundingClientRect()` when "looks off" needs a number.
- Check the database after the click: the row exists, with the right `org_id` and role.

## 3. What to try every time

- Each role that can reach the screen: owner, admin, mentor, scout/student, viewer, parent,
  someone on no team, someone signed out, a platform admin.
- Phone and desktop; light and dark.
- Empty data, one item, many items (seed 50+), very long names, emoji, non-English names.
- Wrong input, double-click the submit, reload mid-flow, back button, two tabs at once.
- Slow or failed API (stop the DB briefly): the page must say so and offer Retry, not hang.
- Keyboard only: Tab order, visible focus ring, Enter submits, Esc closes dialogs.

## 4. Read your screenshots like a designer

Alignment with the page title and tabs; one primary action; no duplicate buttons or empty
cards; text readable (≥ 11px captions, 13–15px body); badges coloured by meaning (red = broken,
amber = needs setup, green = done); nothing cut off or overlapping; nothing that says "Loading…"
after the page settled. See `vantage-ui-design`.

## 5. Report what you saw

In the PR and your final message: the accounts and pages you tried, at which sizes, what you
checked in the database, and what you did **not** test. Attach or describe the key screenshots.
Never claim a flow works if you only ran unit tests.
