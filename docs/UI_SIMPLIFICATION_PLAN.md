# UI simplification — diagnosis, rules, and plan

Written 2026-08-23. Companion to `docs/WHAT_IS_VANTAGE.md` (what/who) and `docs/CODEBASE_PLAN.md`
(repo health). This file is about making the product simpler to use.

## 1. The diagnosis — it is not what it looks like

The complaint was "so many individual features, many don't even work, they're just there." A full audit of
**219 routes, 326 API handlers, and 141 compute modules** found the opposite of the expected problem:

| Suspected defect | Actual count |
|---|---|
| API routes that are unconditional stubs | **0 of 326** |
| Product pages rendering hardcoded fake data | **0 of 270** |
| Fully-built, DB-backed, tested pages **no menu reaches** | **~45** |

Every feature is real, wired to Postgres, and tested. `setup_required` is never returned unconditionally —
it is always a `catch` fallback after a genuine compute call. So the features work; **people just cannot
find them**, which feels identical from the outside.

The real defects are:

1. **Orphaned features.** ~45 working routes had no entry in `hubs.ts`, so they were absent from every menu
   *and* from the ⌘K catalogue (which is generated from `hubs.ts`). The only way in was typing the URL.
2. **Depth.** 6 hubs × ~160 tabs. Strategy alone had 22 nested tools; Build → Robot had 20. They were hidden
   inside a native `<select>` whose options you cannot see without opening it.
3. **Team's tools were unreachable in-app.** `product-hub.tsx` contained `if (hub.id === "team") return []`,
   so all 17 Work tools and 10 Playbook tools rendered no navigation at all.
4. **A redirect interstitial on most tool clicks.** Only ~33 of 160 tabs render inside their hub. The other
   ~127 fell through to `HubLegacyRedirect`, which paints "Taking you to the full page…" and *then* navigates.
5. **Search that could not find things.** The palette matched a plain substring against context-free labels
   ("Forms", "Coverage", "Shifts"), so "scout", "bumpers" and "onshape" returned nothing useful.
6. **Dead-end error states.** Every failed panel offered the same "Retry" — including on a 401, where retry
   can never succeed. A tablet left signed in overnight in the pit comes back to an unrecoverable screen.
7. **Three competing token sets.** `--soft-*`, `--app-*` (defined twice, teal then blue) and `--m-*` across
   **166 CSS files / 22,698 lines**. `--app-accent` resolves through four declarations; `styles.css` loads
   last and wins ties with `!important`, which is why dark mode breaks on shared primitives.

## 2. The rules we are designing to

Distilled from Apple HIG, Tesla's single-canvas in-car UI, Microsoft Fluent 2 / Windows 11 search-first Start,
and the command-palette lineage (VS Code ⌘⇧P, Linear/Raycast ⌘K). Each is written so a reviewer can check it.

| # | Rule | Check |
|---|---|---|
| R1 | ≤5 primary destinations, every viewport. No "More" in that set. | count nav items at 375/768/1280px |
| R2 | No feature reachable *only* by URL — every route needs a menu path **and** a palette entry | `route-coverage.test.ts` |
| R3 | ≤2 disclosure levels: hub → section → tool. Never a third. | assert max depth in `hubs.test.ts` |
| R4 | Exactly one primary button per screen (zero is fine, two is a bug) | lint / E2E counter |
| R5 | ≥44px touch targets; 48px and ≥12px gaps in competition mode (gloves, cold hands) | Playwright bounding-box sweep |
| R6 | Any tool in the palette's top 5 within ~2 keystrokes of its name | `route-coverage.test.ts` |
| R7 | Palette opens on 5 recents, spread across workspaces, with the shortcut shown | `command-search.test.ts` |
| R8 | Every failure state offers the action that actually resolves it — never a Retry that cannot work | `load-failure.test.ts` |

The full 18-rule brief, with the Apple / Tesla / Fluent / Base44 sourcing and live URLs, is in
`docs/UI_DESIGN_RULES.md`. R2 and R6 already run in CI.

## 3. Shipped in this pass

All changes are additive; no working route was deleted, and every folded URL still resolves.

**Findability**
- `apps/web/lib/nav/command-search.ts` — new ranked catalogue. Gives every destination a hub breadcrumb
  ("Competition › Scouting") and a synonym list in the words teams actually use, then ranks by exact →
  prefix → word-initial → keyword → stem → subsequence. Verbs ("Clock in to the shop") are merged in so
  intent phrasing works. 24 tests.
- `apps/web/lib/nav/recent-commands.ts` — device-local MRU so the palette opens on what you actually use.
- `app-shell.tsx` — ↑/↓ selection with a highlighted row across both result groups, `aria-activedescendant`,
  and a labelled desktop search field showing `⌘K` / `Ctrl K` instead of a bare unlabelled icon.

**Depth**
- `apps/web/components/ui/tool-strip.tsx` + `lib/nav/tool-strip-layout.ts` — the hidden `<select>` became
  visible chips: active tool always on screen, pinned tools first, overflow expands in place. 11 tests.
- Removed the `hub.id === "team"` early return, restoring navigation to Team's 27 tools while keeping the
  Team root deliberately clean (Calendar shows zero chips).
- `embeddedTabs` on `ProductHubShell` — a tool the hub does not render inline is now a real link, so the
  "Taking you to the full page…" interstitial is gone for the ~20 standalone tools per section.

**Recoverability**
- `apps/web/lib/ui/load-failure.ts` — classifies a failure as auth / forbidden / offline / setup / unknown and
  returns the right action. 401 now offers "Sign in again" (with a same-origin-only `next=`); Retry only
  appears where retrying can work. 19 tests, including an open-redirect guard.
- `components/ui/error-state.tsx` classifies from the message when no status was kept, so the 34 surfaces
  already using the shared primitive were fixed without touching them.
- **129 hand-rolled failure blocks across 128 client components** converted to the classifier; 126 of them
  now capture the real `response.status`. Nine files were deliberately skipped — they already use the shared
  `ErrorState`, or their "could not load" string is an inline action error rather than a panel failure
  (`/invite` has its own richer domain classifier and was left alone).
- Measured on 35 routes with an expired session: **dead-end "Retry" panels went from 21 to 0**, with 20
  routes now offering "Sign in again".

**Consistency**
- `--app-positive-fill` / `--app-critical-fill`: the dark-mode pass lightened the status colours for
  readability *in* text, which dropped white-on-fill buttons to ~3.3:1. The three text-on-colour buttons
  (`/hours` clock-out, `/inspection` pass/fail) now use dedicated fill tokens that hold ~5:1.
- `.hub-tool-chip` is 34px on a mouse and **44px on touch** (`pointer: coarse`), per R5.

**Regression guards**
- `apps/web/lib/nav/route-coverage.test.ts` — enumerates `app/**/page.tsx` and fails the build if any product
  route has neither a menu entry nor a single inbound link, with the orphan list in the failure message. Also
  asserts R6, and that the route tree still has >200 routes (the mass deletion that happened earlier this
  session would now fail a test). **Currently reports zero unreachable routes.**
- `apps/web/lib/ui/css-integrity.test.ts` — balanced braces and no declaration outside a rule, across all
  166 stylesheets. This is the exact bug that 500'd four hubs (see `docs/CODEBASE_PLAN.md` §2.3) and that
  neither typecheck nor any unit test could see.
- `apps/web/lib/nav/hubs.test.ts` — no duplicate tab id or `legacyHref` within a hub, every nested tab
  resolves to a real workbench root, and the previously-orphaned routes stay registered.

## 4. What is left, in priority order

**Next**
1. Give the remaining three `message`-only conversions (`business-client`, `season-finance-client`) a real
   `response.status` so a 403 is told apart from a 401.
2. `ErrorState` lets a caller-supplied `title` win over the diagnosis, so a few call sites
   (`command-client`, `logistics-client`) still show a feature heading above an expired-session body. Decide
   whether the diagnosis should win when the failure is auth.

**Then — the structural simplification (the big one)**
4. Collapse 6 hubs × 160 tabs into **5 workspaces × ~6 sections** (Home, Compete, Build, Team, Business),
   folding Media into Business → Outreach and making AI a persistent assistant rail rather than a destination.
   Every folded URL keeps working via `legacy-redirects.ts`. This is what gets the app to R1/R3, and it is a
   multi-day change that should land behind its own review.

**Then — one token system and one button**

The measured state of the design layer, which is why the app looks inconsistent:

| Thing | Reality |
|---|---|
| CSS files / lines | 166 files, 22,698 lines, 9,830 rule blocks. One CSS Module; everything else global. |
| Loaded on every route | `marketing.css` (1,949) + `soft-ui.css` (2,472) + `styles.css` (417) = 4,838 lines |
| Token sets | 3 competing: `--soft-*` (23, the only complete light/dark pair), `--app-*` (16, defined **twice** in `styles.css` — teal at :20, blue at :65), `--m-*` (32, marketing) |
| `--app-accent` | resolves through **4** declarations depending on route and theme |
| Button systems | **6**. `.app-button` 447 uses, `.primary-action` 70, shared `<Button>` 46, `.soft-btn`, 29 per-feature classes, and 239 bare-`button` rules across 29 files |
| Raw `<button>` vs `<Button>` | 1,370 vs 46 — **3% adoption**, across 51 distinct class tokens |
| `.primary` modifier | redefined in **33** different CSS files |

The concrete symptom: `.app-button.secondary` is white and 44px tall; `.btnSecondary` is `#eef2f7` and ~35px.
Two secondary buttons side by side are different colours and heights.

5. Delete the second `:root` block in `styles.css`, fold its tokens into `--soft-*`, retire the `!important`
   colour overrides, and add `input`/`select`/`textarea` to `components/ui`. Then drive `<Button>` adoption
   with a lint rule rather than by hand.

**Then — the integrations that make separate tools one flow**
Ten were specified in detail; the highest-value four, each needing a migration:
6. **One task entity** behind list / board / burndown / retro actions — closing a retro item moves the
   burndown (`team_todos` + `build_burndown_tasks` + `retro_action_items` → `build_tasks`).
7. **One pick-list spine** — the collaborative list, the AI justification and the Saturday draft board are
   currently three separate tables describing the same ranking.
8. **A match note that says "it broke" becomes a repair and a failure pattern** — scout note → pit repair
   triage → FMEA row, before the robot is back in the pit.
9. **RSVP → roll call → hours as one presence record**, so "who is coming tonight" and "who was here" stop
   being two unrelated answers.

## 5. Why the structural collapse was not attempted in this pass

Section 4 item 4 (6 hubs / 160 tabs → 5 workspaces / ~28 sections) is the change that actually delivers R1
and R3, and the target structure is fully specified — every one of the 219 audited routes has a named
section to land in. It was deliberately left for its own change because of what it requires beyond the
`hubs.ts` edit:

- **Only ~33 of 160 tabs render inside their hub today.** The other ~127 live on standalone pages. Collapsing
  the catalogue without first embedding those tools would either strand them or reintroduce the redirect
  interstitial at greater scale.
- **Business does not use `ProductHubShell`.** It hand-rolls its own second-level `TabBar`, so it has to be
  converted before it can hold five sections.
- **AI stops being a destination** and becomes an assistive rail on every workspace — a shell change, not a
  nav change.

Doing it safely means embedding the tools first, hub by hub, with `legacy-redirects.ts` keeping every old URL
alive. `route-coverage.test.ts` already guards the invariant that matters during that migration: nothing may
become unreachable.

## 6. Honest notes

- The "14 of 35 routes show an error" figure from the browser sweep is inflated by the E2E fixture: its
  cookie satisfies the proxy but not Better Auth, so product APIs return 401. The *code path* is real and
  worth fixing — session expiry produces exactly this — but it is not evidence that 14 features are broken
  in production.
- Route counts differ slightly between the audit (219 classified) and `route-coverage.test.ts` (enumerates
  every `page.tsx`, including public and gated ones). The test is the one that runs in CI.
