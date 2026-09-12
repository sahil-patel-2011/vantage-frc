# Architecture

*For contributors and anyone deciding whether to build on or self-host Vantage. Last reviewed
September 2026. Where this document and the code disagree, the code wins — tell us.*

## The shape of the system

Vantage is a **modular monolith**: one deployable web application with its domain logic split into
workspace packages, plus small worker programs that run on hardware a team owns.

```
apps/web            the only shipping deployment — marketing site, sign-in, every product page and API route
apps/desktop        Electron shell around the hosted web app (Windows MSI/NSIS/portable, macOS DMG)
packages/*          domain logic shared by the web app and the workers (see the table below)
scripts/            migrations runner, deploy preflight, RLS proof, backtests, Pi install
```

There is no separate API server, no message broker and no cache layer. PostgreSQL is the only
datastore, the job queue, and the shared cache. This is deliberate: the security model (below) lives
in the database, and one process talking to one database keeps that model in one place.

## The request path

1. `apps/web/proxy.ts` protects every route that is not on the public allowlist. Product pages need a
   session; a few token-scoped routes (calendar feeds, share links, public forms) are allowed by a
   32-hex token pattern.
2. A page or API route resolves the session (Better Auth) and the active team, then opens a database
   transaction with `withRls({ userId, orgId })`. That sets `app.user_id` and `app.org_id` for the
   transaction.
3. Every query runs as the `vantage_app` role, whose row-level security policies read those two
   settings. A query cannot see another team's rows even if the application code has a bug.
4. Compute modules (`apps/web/lib/<feature>/`) do the work with parameterized SQL and return plain
   objects; the route serializes them. Routes are thin on purpose.

Request code is lint-blocked from importing the worker database client. Only workers use it.

## Data and tenancy

- **Host today:** Neon ([docs/NEON.md](NEON.md)). Local Postgres and a documented Supabase **Postgres host**
  cutover ([docs/SUPABASE_CUTOVER.md](SUPABASE_CUTOVER.md)) use the same schema and roles. Identity is Better Auth, never
  Neon Auth / Supabase Auth / Data API keys. We do not use the Neon Branches API or Neon-only extensions.
- **Schema:** `packages/db/migrations/NNNN_slug.sql`, append-only, applied in numeric order by
  `scripts/run-migrations.mjs`. Never renumber or edit a shipped migration; add the next one.
- **Roles:** `vantage_app` (requests), `vantage_worker` (background jobs, bypasses RLS), `vantage_auth`
  (identity tables), `vantage_marketing` (waitlist), `vantage_pairing` (device pairing endpoints).
  Login roles are created by the operator and granted these group roles.
- **Tenancy:** every team-scoped table has `org_id`, `ENABLE ROW LEVEL SECURITY`, and policies built
  from `is_org_member(org_id)`, `has_org_role(org_id, …)` and `current_app_user_id()`. Public,
  token-scoped access goes through `SECURITY DEFINER` functions with `search_path` pinned.
- **Proof:** `scripts/rls-proof.mjs` connects as a non-superuser login and asserts, table by table,
  that cross-team reads return nothing. CI runs it against a fresh database with every migration
  applied.
- **Reference data:** The Blue Alliance and Statbotics are read by one ingest worker into shared
  tables (`matches_ref`, `team_event_metrics`, …) with ETag validators and backoff. Product code reads
  the cache; it never polls those APIs per team.

## The AI path

Every AI call goes through one of two doors:

- **Request path:** `meteredAI` in `@vantage/billing` — locks the team's billing row, sums the usage
  ledger, enforces caps, calls the provider, appends usage. There is no cached credit counter.
- **Worker path:** the free-relay adapter on a paired Raspberry Pi, for chat streams and long jobs.

Provider order is **paired relay → the team's own keys → hosted key**, and the product tells the
person which one answered. Keys are envelope-encrypted per team (AWS KMS in production, a local
substitute in development that refuses to start in production). Chats are compacted automatically:
older turns fold into a summary so the context stays inside the model window, and the original turns
remain expandable.

## Background work

- **Scheduled:** Vercel Hobby allows two crons, both in the root `vercel.json` (`/api/cron/tba-sync`
  in `event-day` and `season` modes). Everything else that must run daily is a *piggyback* on the
  season cron (`apps/web/lib/reference/season-cron-piggybacks.ts`). Do not add a third cron.
- **Queued:** `free_relay_jobs`, `assembly_manual_runs` and `video_analysis_jobs` are lease-based
  queues in Postgres (owner, lease expiry, heartbeat, checkpoint, cancel flag). A worker that dies
  loses its lease and another picks the job up from the checkpoint.
- **Where workers run:** `packages/free-relay` on a Pi with a role — `chat`, `agent` or `video` — one
  systemd instance per role (`scripts/pi/vantage-relay@.service`). Pis pair with a human code and a
  hashed device token, and report liveness by heartbeat; the app never trusts a stored status column.

## Offline

Competition venues have bad networks, so the web app is built to keep working without one:

- A service worker precaches the shell routes; `lib/offline/feature-cache.ts` keeps each page's last
  snapshot in IndexedDB and paints it before the network is asked.
- Writes made offline go to per-feature outboxes with idempotent client ids and sync on reconnect;
  scouting additionally has QR hand-off and a BroadcastChannel pit mesh between tablets.
- IndexedDB rule: open one transaction and enqueue every request synchronously; never `await` between
  opening and using it (this has bitten the codebase before).

## Desktop and team hardware

- `apps/desktop` wraps the hosted app in Electron, checks for a newer release on launch (see
  `docs/DESKTOP.md`), and hosts the Fusion 360 relay locally.
- Optional devices pair with a team using the same pattern (code → hashed token → heartbeat): the
  **storage node** (large file bytes on a machine the team owns), the **Pi relay** (AI), and the
  **Fusion relay** (CAD). None is reachable from the internet; the app talks to them on the LAN or via
  queued jobs.

## Packages

| Package | Responsibility |
|---|---|
| `db` | Drizzle schema, `withRls` request client, worker-only admin client, SQL migrations |
| `core` | Better Auth setup, tenancy, invites, onboarding, notifications, legal versions, admin audit |
| `billing` | Metered AI, usage ledger, plan catalog, BYO-key encryption, Stripe contract |
| `reference` | TBA and Statbotics clients, coordinated rate-limited ingest, team dossiers |
| `scouting` | Form schemas, QR envelopes, trust and conflict rules, imports |
| `prediction-strategy` | Match prediction and strategy math (see `docs/PREDICTION_RESULTS.md`) |
| `game-year` | Year-specific game packs |
| `cad` | Onshape OAuth and API, Fusion relay protocol, mass properties, CAD tool catalog |
| `agent` | Chat adapters, system prompts, tools, context compaction, Bugbot |
| `free-relay` | The Pi worker: job leasing, chat streaming, assembly manual, video analysis |
| `connector` | Shared core of the downloadable connector (pairing, device identity, capabilities) |
| `storage-node` | The self-hosted file node |
| `intel-research` | Scheduled and on-demand research jobs |
| `import` / `export-center` | Bring-your-season importers and team-scoped exports |
| `vantage-cad-cli`, `fusion360-official-connector`, `vantage-vscode`, `ai-bridge` | Developer-facing connectors |

## Rules for new work

- New capabilities land in a workspace section or a package — never as an orphan route. Every route
  must be reachable from navigation and listed in `docs/FEATURE_MAP.md` (a test checks this).
- Every request database access goes through `withRls`; every new team-scoped table gets RLS, policies
  and grants in its migration, and a block in `scripts/rls-proof.mjs`.
- Every AI call is metered and tagged with its feature.
- No feature shows a number it did not compute from real rows.
- User-facing copy says what the person sees and what to do next; engineering vocabulary is
  lint-blocked (`apps/web/lib/ui/copy-lint.test.ts`).

## Verification

```sh
npm run typecheck                       # every workspace
npm run lint
npm test                                # ~8,600 unit tests, credential-free, ~90 s
npm run build --workspace=@vantage/web  # must compile with zero warnings
node scripts/deploy-preflight.mjs       # env and migration inventory
node scripts/rls-proof.mjs              # needs a local Postgres and a non-superuser login
npm run test:browser                    # Playwright vs http://127.0.0.1:3310 (E2E_AUTH_FIXTURE, local vantage_ci; four sequential shards)
```

See [../CONTRIBUTING.md](../CONTRIBUTING.md) for the local database recipe and the pull-request
checklist.
