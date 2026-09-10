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
| `npm test` | **878 files, 8,320 passed, 10 skipped, 51.93s** | `vitest run` this session |
| `npm run typecheck` | clean across workspaces that changed | this session |
| `npx eslint .` | clean (exit 0) | this session, 30.7s |
| `npm run build --workspace=@vantage/web` | compiled, **zero warnings** in the log, 695 pages; `/connectors` `/team/relays` `/video-analysis` in the route table. Shared runtime 540.3 KB. | `next build` this session, 66.4s |
| `node scripts/deploy-preflight.mjs` | 8 FAIL in this image (no Vercel env). Owner must still set `CRON_SECRET` in the project. | this session |
| `npm audit --omit=dev` | **0 vulnerabilities** | this session |
| `scripts/rls-proof.mjs` | *not run* | needs local Postgres (not in this image) |
| Latest migration | `0654_library_into_drive.sql` | next free number ≥ `0655` |

### Competitive notes

See `docs/COMPETITIVE_NOTES.md`. That document is the brief for Tasks 2–4.

### UI pass log (Task 3 running list)

| Route | What was wrong | Commit |
|---|---|---|
| `/competition` Event day | Duplicate page header when embedded in the hub; poll ran while the tab was hidden | this branch |
| `/strategy` From our scouting | "pEPA" and "Private Edge" were jargon | this branch |
| `/files` | "enforced by the database" | this branch |
| `/strategy` pick list | "org pEPA" in the event pool | this branch |
| `/workflow` | "platform admin", "setup-required", "Private Edge", "BYOK" | this branch |
| `/features/strategy` | "Private Edge" | this branch |
| Settings | "My AI keys" duplicated "AI keys" | this branch |
| Team admin / GitHub related | Connections pointed at a dead Account tab; now `/connectors` | this branch |
| `/dashboard` | Student/mentor default widgets were empty stamps with no live view | this branch |
| `/ai` Finance | "Finance-in-AI" on student screens | this branch |
| `/offline` | "Offline shell ready" | this branch |
| `/ai` Agent | "setup_required" shown as a pill | this branch |
| `/team/relays` | Connector card only — no list of paired Pis, roles, or queue | this branch |
| `/account` Connections tab | Duplicate of `/connectors`; now redirects | this branch |
| `/hours` `/messages` `/match-checklist` `/match-notes-timeline` | Offline writes said they would wait, then dropped the change | this branch |
| `/packing` `/batteries` `/pit` `/tasks` | Last snapshot was dropped when venue Wi-Fi died; packing ticks and battery logs were not queued | this branch |
| `/pit` | "no invented percentage" on the board | this branch |
| `/files` | No way to keep a file on the device | this branch |
| `/strategy` empty | "Neon cache", TBA_AUTH_KEY, "will not invent EPA" | this commit |
| `/calendar` | Breadcrumb repeated "Calendar / Season Calendar"; offline edits lied then dropped; ⌘K "season calendar" opened the shop calendar | this commit |
| Chat limits / Usage / Pricing / Help | PAYG, kill switch, BYOK, TBA_AUTH_KEY leaked into student copy; copy-lint now scans related-copy + the manual | this commit |
| Rankings banner | "Data source degraded", ETag/Neon | this commit |
| `/ai` Agent | `setup_required` / `running` shown as pills | this commit |
| `/offline` `/offline-shell` | "Offline Shell", "precache" | this commit |
| `/workspace` empty states | "Select a team workspace" / "Open Workspace" | this commit |
| `/competition` Scouting empty | Coverage/Strategy/Offline duplicated the hub strip and next-actions | this commit |
| Competition empty cards | Empty/setup walls still offered 3–4 sibling buttons (Open Strategy, Open Coverage, …) | this commit |
| `/scouting/forms` | Match / Pit used a TabBar under the hub tabs | this commit |
| `/team/data` | "Workspace inventory" | this commit |
| Home widgets / related strips / intel nav | Student copy still said Workspace on Home empty cards, related strips, Event Day setup, and `Workspace →` crumbs | this commit |
| `/workspace` document title | Browser tab said Workspace | this commit |
| `/video` review detail | Re-scout / Notes used a TabBar under the page header | this commit |
| `/my-day` `/schedule` | Last snapshot dropped when venue Wi-Fi died | this commit |
| Native product buttons | leftover `<button className="app-button">` on submit/in-page actions | this commit |
| `/command` | Event Day not on the service-worker shell list | this commit |

---

## Task progress

| # | Task | Status | Verification |
|---|---|---|---|
| 1 | Land / baseline / competitive notes | done | this file + `COMPETITIVE_NOTES.md`; latest full suite **879 files, 8,322 passed, 10 skipped** (52.46s) |
| 2 | One design system | in progress | tokens in `system.css`; Button emits `.app-button`. Product `<a className="app-button">` and leftover native `<button className="app-button">` now use `<Button>` (this session: 1130 anchors + 881 native buttons). Remaining `app-button` classes are disabled `<span>` chrome, not clickable controls. CSS token alias cleanup still open. |
| 3 | Full UI pass | in progress | Student copy says team, not workspace, on Home widgets, related strips, Event Day setup, intel crumbs, and `/workspace`. Empty/setup cards keep one primary (`<Button variant="primary">` counts). Video re-scout review tools are a ToolStrip. FEATURE_MAP walk unfinished. No signed-in student/mentor browser walk. |
| 4 | Home widgets | in progress | Live cards in `widgets/home-cards.tsx`. Canvas helpers in `dashboard-canvas.ts`. Widget chrome/empty copy in `widgets/widget-shell.tsx`. Competition/ops widgets in `widgets/ops-cards.tsx`. Board types in `dashboard-board-types.ts`. First-run banner, board switcher, widget palette, library sheet, boards modal, and edit/preview docks are sibling modules. `dashboard-client.tsx` is still the drag/save shell. |
| 5 | Offline shell | in progress | Season calendar, packing, batteries, pit, season-tasks already queued. **My Day**, **Schedule**, and **Event Day** (`/command`) restore the last IndexedDB snapshot when the fetch fails. `/my-day` and `/command` are on the service-worker shell list. Playwright spec covers `/my-day`, `/schedule`, and `/command` offline reloads. No signed-in `next start` walk. |
| 6 | Desktop installers + auto-update | in progress | `/api/desktop/release`, NSIS+MSI+DMG workflow, unsigned license. macOS artifacts cannot be built in this image. |
| 7 | freebuff Pi fleet | in progress | `docs/FREEBUFF.md`, pairing API, `/team/relays` node list, compact+prompt. TTFT unmeasured (no Pi). |
| 8 | Match prediction ±3 | in progress | Next match widget shows calibrated score + ±band when year EPA exists. Fixture (2 matches, 4 alliance scores): MAE **89.7**, RMSE **89.88**, within ±3 **0%**, within ±5 **0%**. UI band is `DEFAULT_ERROR_BAND = 8` (placeholder). **Not a season ±3 claim.** |
| 9 | Video analysis | in progress | schema + queue UI + confirm-as-evidence. Confirmed events now appear on the match-notes timeline as **From video**. Worker skips without a vision model. No live Pi. |
| 10 | Connectors | audit (already on main) | Account `?tab=integrations` redirects to `/connectors`. TBA next-action from Account goes there too. |
| 11 | Copy sweep | in progress | copy-lint bans allowlist, PAYG / kill switch / BYOK, and leftover workspace-as-team-picker phrases. `/workspace` page title is Your team. Onshape/Slack "workspace" kept. |
| 12 | Bugbot / agents | in progress | quotes required (existing); prompt now forbids push/PR; compact wired in HTTP adapter. Scan time unprinted. |
| 13 | CAD / assembly manual | in progress | Ask AI plans `cad.vault` for heavy-part / fastener questions; session facts list vault titles and Onshape links (no fabricated kg). Prompt pins "Cite vault documents by title". Assembly manual on a real Onshape document still unverified. |
| 14 | Business funding models | in progress | `funding_model` column, onboarding radios, Business default tab + sponsor hide |
| 15 | Modular monolith | in progress | ESLint `no-restricted-imports` on dashboard/offline/drive/workspace/account/invite/connectors/onboarding/help/bugbot/business/cad-vault/packing/season-calendar vs scouting/messages/pit/hours. `FEATURE_DIRS` now also includes bugbot, business, and cad-vault. File-path matching covers `packing.ts` / `season-calendar.ts` (rel === dir). `funding-profile.ts` is shared onboarding types, not a feature folder. |
| 16 | Supabase readiness | in progress | preflight dual URLs + rehearsal script. **Not connected.** |
| 17 | Performance / cost | in progress | Home, Event day, Pit, Display, assembly-manual, exports, storage, hours kiosk, and the outbox badge skip while the tab is hidden. Production `next build` this session: compiled 15.5s, TypeScript 45s, 695 pages, no warnings in the log. Shared runtime (rootMain + polyfill) **540.3 KB**. Unique client-reference JS: Home `/dashboard` 391 KB, Scouting 391 KB, Strategy 325 KB, Pit 284 KB, `/workspace` 248 KB. Next 16 Turbopack does not print a First Load JS column in the route table. |
| 18 | Final verification | pending | |
