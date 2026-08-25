# Codebase plan — state of the repo and what to do next

Written 2026-08-23 on branch `cursor/simplify-team-hub` after a full exploration + test pass.
Companion to `docs/WHAT_IS_VANTAGE.md` (what/who) — this file is the "where are we and what next".

## 1. Snapshot

| Dimension | Value |
|---|---|
| Shipping app | `apps/web` (Next.js, port 3001) — marketing + auth + every product route |
| Product routes | ~200 top-level `app/<feature>` dirs organized into 6 hubs; most are "More tools" leaves |
| API routes | 326 `route.ts` files under `apps/web/app/api` (219 first-segment groups) |
| Domain packages | 15 under `packages/*` (db, core, billing, reference, scouting, game-year, import, prediction-strategy, cad, agent, intel-research, export-center, vantage-cad-cli, vantage-vscode, fusion360-official-connector) |
| Migrations | 289 SQL files, append-only, latest `0442_member_llm_keys.sql` (uncommitted) |
| Unit tests | 457 `*.test.ts` files (vitest, credential-free; 395 of them under `apps/web/lib/**`) |
| Browser tests | 8 Playwright specs / 27 tests in `tests/browser` (auth fixture, marketing, pricing, product shell, mobile nav, theme, waitlist, event-day shells) |
| Database | Postgres (Neon in prod, Supabase-ready), Better Auth identity, RLS tenancy |

## 2. Findings from this pass

### 2.1 Accidental working-tree wipe (fixed)
At 13:05–13:06 today every **nested** directory under `apps/web/app/` was deleted from disk — all 326 API
routes, 68 `app/team/*` sub-pages, all `app/admin/*` pages, plus `scouting/forms`, `strategy/draft`,
`cad/setup`, etc. (454 files). No top-level page file was touched and the surviving client code still
fetches `/api/...`, so this was not part of the "simplify team hub" refactor. Restored with
`git checkout HEAD -- <deleted paths>`; the 50 modified + 12 new files of real in-flight work were left as-is.

**Follow-up:** figure out what ran the sweep (it removed exactly `find apps/web/app -mindepth 2 -type d`).
OneDrive sync on this checkout (see §2.4) is a plausible culprit. Consider a test that fails if
`apps/web/app/api` has fewer than 300 routes.

### 2.2 Corrupted `node_modules` (fixed)
`vitest`, `rolldown`, and `next` had dist files from two different builds mixed together (e.g. `cli.js`
importing a chunk hash that did not exist). Symptoms: vitest startup error, and a bogus typecheck storm
(`next/navigation has no exported member useSearchParams`, `@vantage/billing/catalog not found`).
Fixed with `npm ci`. Results of the clean run are in §3.

### 2.3 Committed regression: orphaned CSS block → HTTP 500 on four hubs (fixed)
Commit `80859a3` rewrote the toolbar section of `apps/web/app/team/calendar/team-calendar.css` and dropped
the `.tc-mode {` selector line, leaving `display: inline-flex; …` outside any rule. Next's CSS parser rejects
the whole file, and because that stylesheet is in the product-shell import chain, **`/team`, `/build`,
`/account`, and `/ai` all returned 500** (dashboard, competition, and marketing were unaffected). Fixed by
restoring the one selector line. Neither vitest nor typecheck can catch this; only a browser run can — and
the browser suite was both undiscoverable (§2.4) and already red (§3), so nothing flagged it.

### 2.4 Browser tests silently un-discoverable on this machine (worked around)
`npx playwright test` → "No tests found". The checkout lives under OneDrive; every file carries cloud reparse
tag `0x9000201A`, and Node 24's `readdir({withFileTypes})` reports those entries as symlinks, so Playwright's
walker (`dirent.isFile()`) sees zero specs. Vitest uses a different walker and is fine. Workaround used: a
~15-line `fs.Dirent` patch preloaded with `NODE_OPTIONS=--require <scratch>/dirent-onedrive-fix.cjs`.
Permanent options: move the checkout out of OneDrive (README already recommends
`C:\Users\sahil\Cursor Projects\Vantage`), or vendor the preload under `scripts/` and wire it into `test:browser`.

### 2.5 In-flight branch work (uncommitted, keep)
The branch's real change set — 50 modified + 12 new files, ~1,048 insertions / 1,631 deletions:

- **Team HQ strip** — `apps/web/lib/team/team-hq.ts` + `components/team-hq-strip.tsx`: Calendar · Chat ·
  Playbook · GitHub as the four primary Team actions; sign-in flow simplified (`lib/sign-in/sign-in-flow.ts`).
- **CAD agent sessions** — `apps/web/lib/cad/{cad-agent-session,run-cad-agent,onshape-tokens}.ts`,
  `packages/cad/src/{cad-agent-action,onshape-url}.ts`: persisted Claude-CodeCad chat bound to an Onshape URL.
- **Personal AI keys** — migration `0442_member_llm_keys.sql` + `schema.ts`, `lib/ai-keys/byok-providers.ts`,
  `packages/agent/src/resolve-chat-adapter.ts`: per-member OpenAI/Anthropic keys override team keys; OpenAI
  base URL for Ollama / LM Studio.
- **Theme toggle moved** from the dashboard header into `/account` (`account-client.tsx`).
- **Access policy / email 2FA** tweaks in `packages/core`, Postgres URL parsing in `packages/db`.
- Dashboard catalog, product nav, help articles, FEATURE_MAP, and two browser specs updated to match.

Each new module has a sibling `.test.ts` (`team-hq.test.ts`, `cad-agent-session.test.ts`, `onshape-url.test.ts`).

## 3. Test results (clean install, 2026-08-23)

| Suite | Result |
|---|---|
| `npm test` (vitest) | **457 files, 3,223 tests, 0 failures** (47 s) |
| `npm run typecheck` (all workspaces) | **0 errors** |
| `npm run test:browser` (Playwright, 27 tests / 8 specs) | **15 passed, 12 failed** — all 12 are assertion drift, classified below |
| Manual Chromium smoke with `E2E_AUTH_FIXTURE=1` (9 routes: `/`, `/pricing`, `/signin`, `/dashboard`, `/competition`, `/team`, `/build`, `/account`, `/ai`) | all **200**, zero page/console errors after the §2.3 fix (four were 500 before it) |

The 12 browser failures, classified (none is a crash after the CSS fix):

| Spec | Why it fails | Verdict |
|---|---|---|
| `auth.spec.ts:3` | Landing now has three "Sign in" links (header, hero, footer) → strict-mode violation | stale selector — scope to `getByRole("banner")` |
| `auth.spec.ts:22` | Expects `next=/scouting…`; app now redirects `/scouting` → `/competition?tab=scouting` | intentional hub redirect — update expectation |
| `event-day-shells.spec.ts:25` ×3 (phone/tablet/desktop) | Expects a "Choose workspace" link; under the fixture the scouting hub renders "Could not load scouting" (API 401, no DB) | **needs a product decision** — the fixture session should probably produce the setup shell, not an error card |
| `pricing.spec.ts:3` | Heading is now "Start free. Buy AI credits when you need them." | stale copy |
| `product-shell.spec.ts:69` | Two "Close navigation" buttons (icon + scrim) → strict mode | stale selector (`.first()`), or drop the aria-label from the scrim |
| `product-shell.spec.ts:100` | Account h1 is now "Your settings" | stale copy |
| `product-shell.spec.ts:119` | Code tab heading is now "Code Coach pattern review" | stale copy |
| `theme.spec.ts:3` | Landing h1 is now "Your FRC team, in one place." | stale copy (absent on `main` too — pre-dates this branch) |
| `theme.spec.ts:11`, `:29` | Theme toggle moved from dashboard header to `/account` on this branch | intentional move — retarget the test |

What the green suites actually cover for real-world use:

| Suite | Real-world behaviour exercised |
|---|---|
| `packages/core` | invite tokens, org role tenure (last-admin guard), hub access allowlists, email 2FA policy |
| `packages/billing` | metered AI cap enforcement, ledger sums, BYO-key envelope encryption, pricing catalog |
| `packages/reference` | TBA/Statbotics parsing against fixtures, ETag cache behaviour, idempotent writers |
| `packages/scouting` + `game-year` | 2026 REBUILT form schemas, QR envelopes, trust/identity lock on CSV import |
| `packages/prediction-strategy` | match prediction math, pick-list/EPA ranking, never-fabricate guards |
| `packages/cad` | Onshape URL parsing, Claude-CodeCad action planning, Fusion relay protocol |
| `packages/agent` | model router, BYOK adapter resolution (team vs personal key), bounded context |
| `apps/web/lib/**` | ~395 files: dashboard boards, onboarding flow, sign-in flow, usage cutoff, checklists, battery/power/inspection cues, calendar ICS, exports |
| `tests/browser` (passing half) | dashboard declutter/editor/drag-drop, marketing nav + footer routes, waitlist join, offline shell outbox copy, onboarding gate, strategy empty state, P2P relay, exit interviews |

What is **not** covered at all: no test in the repo connects to Postgres (no `describe.skipIf` anywhere;
the only two files mentioning `DATABASE_URL` test URL parsing). So RLS isolation between orgs, `withRls`
SET LOCAL behaviour, the 289 migrations applying cleanly, Better Auth OTP persistence, and Stripe webhooks
are verified only by manual use against Neon.

## 4. Plan — recommended next steps, in order

### Now (this branch)
1. **Commit the in-flight work** — `npm test` and `npm run typecheck` are green on the clean install.
   Suggested message: *"Team HQ strip, persisted CAD agent sessions, and personal AI keys (0442)."*
2. **Include the `team-calendar.css` fix in that commit** — without it four hubs 500 in production.
3. **Bring the 12 drifted browser specs back to green** (table in §3). Nine are one-line copy/selector
   updates; the three `event-day-shells` scouting cases need a decision on what the fixture session should
   show. While `npm run test:browser` is red it gets ignored — which is exactly how the CSS regression shipped.
4. **Apply migration 0442** to a dev Postgres and smoke-test `/team/ai-keys` Mine vs Team.

### Next (hardening)
5. **Make the browser suite runnable everywhere** — either move the checkout out of OneDrive or vendor the
   Dirent preload (§2.4) under `scripts/` and reference it from `test:browser`; then add it to CI so a CSS
   parse error or a 500 on a hub is caught before merge.
6. **Guard against the directory wipe** — a tiny vitest (`apps/web/lib/nav/route-inventory.test.ts`) that
   asserts `app/api/**/route.ts` count ≥ 300 and every hub tab in `hubs.ts` resolves to an existing `page.tsx`.
7. **Pin `node_modules` integrity** — `package.json` uses `"latest"` for every devDependency; the lockfile
   pins, but a stray `npm install <pkg>` drifts. Use `npm ci` in CI and after any lockfile change.
8. **RLS integration tests in CI** — spin up Postgres in a GitHub Action, apply all 289 migrations as the
   owner role, then add `packages/db/test/rls.integration.test.ts` that creates two orgs and asserts org A's
   `withRls` client cannot read org B's `scout_entries` / `org_llm_keys` / `messages`. Tenancy *is* the
   security model and this is its only untested layer; it would also catch a migration that fails to apply.

### Later (product)
9. The season workflow (`FRC_WORKFLOW.md`) is the best onboarding doc — link it from `/help` and the empty
   dashboard so a new team knows which hub to open in which month.
10. `docs/VANTAGE_FEATURE_ROADMAP.md` still lists items that now ship (Bugbot Ultra, desktop shell); prune it.
11. `apps/marketing` is a redirect shim — schedule its Vercel project for deletion once analytics confirm
    zero hits on the old origin.

## 4b. UI simplification

A separate audit of all 219 product routes, 326 API handlers and the design system produced
`docs/UI_SIMPLIFICATION_PLAN.md`. Headline: there are **no stub APIs and no pages faking data** — the
defect class is ~45 fully-working routes that no menu reached, plus navigation depth and three competing
CSS token sets. That document carries the design rules, what shipped, and the prioritized remainder.

## 5. How to verify a change (quick reference)

```sh
npm run typecheck && npm test          # logic — green as of 2026-08-23
npm run dev                            # http://localhost:3001, boots without a DB
npm run test:browser                   # playwright against :3310 with the E2E auth fixture
# on this OneDrive checkout: NODE_OPTIONS="--require <scratch>/dirent-onedrive-fix.cjs" npm run test:browser
npm run typecheck --workspace=@vantage/web   # single package
```

Before a large edit: `git log --oneline -5`, check file mtimes, and check `git status` for a mass of ` D`
entries — more than one agent (and OneDrive) touches this checkout.
