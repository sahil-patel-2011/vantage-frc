# Vantage status

Living record of the master engineering brief. Update this file at the end of every task. Numbers are from commands that were actually run, not memory.

**Branch:** `cursor/vantage-master-brief-c0b5` off `origin/main` at `1a5a9048`.
**Date opened:** 2026-09-10.

## Decisions the owner should know

1. **Stale remotes were not merged.** Every `origin/{fn,ui,feat,build,pi-freebuff-layer,…}` branch has **no merge-base** with current `main` (unrelated histories after a rewrite). They are 641 commits behind. Unique subjects from those tips (Drive, assembly manual, email spine, budget/roles, desktop shell, visual system) are already on `main` by commit message. Merging them would import an alternate universe of the repo.
2. **`origin/pi-freebuff-layer` “reuse the live official Freebuff session” was dropped on purpose.** Freebuff Terms of Service (effective 2026-09-02) forbid calling their inference “through scripts, custom clients, wrappers, integrations, or third-party software” and require a human to initiate each session. A browser extension that rides a logged-in Freebuff tab is also forbidden. Compliant path: a team pastes **their own relay endpoint + token** (KMS-encrypted), then the Pi uses the official SDK / BYO keys — never Freebuff’s free servers by proxy. Written in `docs/FREEBUFF.md`.
3. **Connectors (Task 10) and copy sweep (Task 11) already landed on `main`** (`379aeada` / `6ec683a4` and follow-ups through `1a5a9048`). This brief still audits them, extends the catalog (free-relay pairing), and keeps `copy-lint.test.ts` green. It does not redo the 548-file merge.
4. **AI path order is relay → team keys → hosted.** Hosted paid keys are never the assumption. Freebuff’s free product is 18+; FRC users are often minors, so team chats must not send student prompts to Freebuff’s hosted free product. The Pi runs DeepSeek via a **self-hosted or officially-licensed** endpoint the owner configures.

## Owner must do (cannot be done from this agent)

1. Set `CRON_SECRET` in the Vercel project env. Deploy preflight FAILs without it. Season piggybacks will not run until it is set.
2. Fix the Vercel account-level deploy dispatch (Hobby, Root Directory = repo root).
3. Paste Supabase (paid + free) and desktop signing/notarization credentials when ready. This branch builds the wiring and leaves the connection off.

---

## Task 1 — Land in-flight work, baseline, competitive notes

### In-flight branches

| Remote | Ahead of main | Merge-base with main | Verdict |
|---|---|---|---|
| `worktree-agent-ad5d6b95912e775e6` | already merged (`6ec683a4`) | n/a | copy sweep — on main |
| connectors agent | already merged (`379aeada`) | n/a | `/connectors` — on main |
| `worktree-agent-aa639af77947124e2` | Drive / assembly-manual history | **none** | already on main as `b54e6a7f` / `482bfc48`; drop |
| `pi-freebuff-layer` | official Freebuff session reuse | **none** | **drop** — ToS forbids wrappers |
| `ui/*`, `fn/*`, `feat/assembly-manual`, `build/complete-product-pass`, `cad/unix-packaging`, `tba/neon-cache-sync`, `marketing-brand-redesign`, `cursor/simplify-team-hub`, `fix/vercel-client-bundle` | 37–590 ahead, 641 behind | **none** | drop; unique work already on main |

Assumption stated: “a new FRC student can do everything from one login without help” is better served by not replaying 500-commit unrelated histories than by a heroic rebase that would reintroduce DEMO copy, client-bundled `pg`, and ToS-violating Freebuff wrappers.

### Baseline (recorded after `npm ci`)

| Check | Result | Evidence |
|---|---|---|
| `npm ci` | 718 packages, 9s | this session, no lockfile change |
| `npm test` | **863 files, 8,262 passed, 10 skipped, 55.21s** | `vitest run` this session |
| `npm run typecheck` | *pending* | |
| `npx eslint .` | *pending* | |
| `npm run build --workspace=@vantage/web` | *pending* | zero-warning required |
| `node scripts/deploy-preflight.mjs` | *pending* | expect FAIL only on `CRON_SECRET` |
| `npm audit --omit=dev` | *pending* | |
| `scripts/rls-proof.mjs` | *not run yet* | needs local Postgres (not in this image yet) |
| Latest migration | `0654_library_into_drive.sql` | next free number ≥ `0655` |

### Competitive notes

See `docs/COMPETITIVE_NOTES.md`. That document is the brief for Tasks 2–4.

### UI pass log (Task 3 running list)

| Route | What was wrong | Commit |
|---|---|---|
| `/competition` Event day | Duplicate page header when embedded in the hub; poll ran while the tab was hidden | this branch |
| `/strategy` Private Edge | "pEPA" and "invented" copy a 15-year-old cannot use | this branch |
| `/dashboard` | New widgets had no icons; Ask AI had no input; next match hid the stored win-chance band | this branch |
| `/team/relays` | Connector card only — no list of paired Pis, roles, or queue | this branch |

---

## Task progress

| # | Task | Status | Verification |
|---|---|---|---|
| 1 | Land / baseline / competitive notes | done | this file + `COMPETITIVE_NOTES.md`; 8,262 tests |
| 2 | One design system | in progress | tokens in `system.css`; css-integrity forbids declarations elsewhere; Button + R4 selector; Playwright sweep added. Chrome `.app-button` migration still open. |
| 3 | Full UI pass | in progress | Event day duplicate header, Strategy jargon, relay list, widget icons. FEATURE_MAP walk unfinished. |
| 4 | Home widgets | in progress | audience defaults, tap-to-place, Ask AI input, next-match win band. 2200-line client not fully split. |
| 5 | Offline shell | in progress | outbox + SW version + Competition snapshot cache + hub OfflineBanner. Not every `*-client.tsx` uses `useOfflineSnapshot`. |
| 6 | Desktop installers + auto-update | in progress | `/api/desktop/release`, NSIS+MSI+DMG workflow, unsigned license. macOS artifacts cannot be built in this image. |
| 7 | freebuff Pi fleet | in progress | `docs/FREEBUFF.md`, pairing API, `/team/relays` node list, compact+prompt. TTFT unmeasured (no Pi). |
| 8 | Match prediction ±3 | in progress | linear model + fixture backtest + match plan helper. **Not a season ±3 claim.** UI shows stored win % + confidence band when a prediction row exists. |
| 9 | Video analysis | in progress | schema + queue UI + confirm-as-evidence (does not merge into scouting). Worker skips without a vision model. No live Pi. |
| 10 | Connectors | audit (already on main) | catalog includes free-relay; pairing public prefixes added |
| 11 | Copy sweep | audit (already on main) | help leftover "never invented" rewritten; copy-lint remains the guard |
| 12 | Bugbot / agents | in progress | quotes required (existing); prompt now forbids push/PR; compact wired in HTTP adapter. Scan time unprinted. |
| 13 | CAD / assembly manual | pending | link-first already on vault; assembly-manual on a real Onshape document still unverified |
| 14 | Business funding models | in progress | `funding_model` column, onboarding radios, Business default tab + sponsor hide |
| 15 | Modular monolith | in progress | `/library` → `/files`; 0654 copies team-wide library rows into Drive; module-boundaries test |
| 16 | Supabase readiness | in progress | preflight dual URLs + rehearsal script. **Not connected.** |
| 17 | Performance / cost | in progress | Home + Event day polls back off when the tab is hidden |
| 18 | Final verification | pending | |
