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
| Latest migration | `0650_profile_theme_chosen.sql` | next free number ≥ `0651` |

### Competitive notes

See `docs/COMPETITIVE_NOTES.md`. That document is the brief for Tasks 2–4.

### UI pass log (Task 3 running list)

| Route | What was wrong | Commit |
|---|---|---|
| *(started after design-system tokens)* | | |

---

## Task progress

| # | Task | Status | Verification |
|---|---|---|---|
| 1 | Land / baseline / competitive notes | in progress | this file + `COMPETITIVE_NOTES.md` |
| 2 | One design system | pending | |
| 3 | Full UI pass | pending | |
| 4 | Home widgets | pending | |
| 5 | Offline shell | pending | |
| 6 | Desktop installers + auto-update | pending | |
| 7 | freebuff Pi fleet | pending | |
| 8 | Match prediction ±3 | pending | |
| 9 | Video analysis | pending | |
| 10 | Connectors | audit (already on main) | |
| 11 | Copy sweep | audit (already on main) | |
| 12 | Bugbot / agents | pending | |
| 13 | CAD / assembly manual | pending | |
| 14 | Business funding models | pending | |
| 15 | Modular monolith | pending | |
| 16 | Supabase readiness | pending | |
| 17 | Performance / cost | pending | |
| 18 | Final verification | pending | |
