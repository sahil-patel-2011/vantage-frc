# Vantage architecture

Single deploy: `apps/web`. Domain logic lives in `packages/*`. Request code uses `withRls` and parameterized SQL. Workers use `dbAdmin` via cron HTTP — not a second service.

## Kernel

- `@vantage/db` — RLS, migrations (append-only; next file is the next free `NNNN`); Neon or Supabase Postgres host (`docs/SUPABASE_CUTOVER.md`)
- `@vantage/core` — Better Auth, invites, `claim_frc_team_workspace`, hub access
- `@vantage/billing` — `meteredAI`, ledger, Stripe
- `@vantage/reference` — TBA, Statbotics, Nexus clients; Neon cache; no per-org TBA pollers

## Domain packages

- `@vantage/scouting` — schemas, QR, trust, import; seeds year packs from `@vantage/game-year`
- `@vantage/game-year` — year-agnostic packs (2026 REBUILT published; 2027 BIOCORE awaiting manual; field-centric `alliance_station`)
- `@vantage/import` — ICS, CSV column map, Notion page mapping (no invented rows)
- `@vantage/prediction-strategy` — match prediction math
- `@vantage/cad` — Onshape / Fusion agent (CAD stays in Onshape/Fusion)
- `@vantage/agent` — metered chat / tools
- `@vantage/intel-research` — research jobs
- `@vantage/export-center` — CSV/ZIP exports (org-scoped AI takeout; no keys)

## Hubs (jobs, not a catalog)

- Competition — Command, My Day, Scouting, Strategy, Pick desk
- Team — Calendar, Tasks, Hours, Knowledge, Messages, **Bring your season** (`/migrate`)
- Build — Kickoff, CAD, Code, Robot
- Business — Budget, Sponsors, Grants, Impact (FIRST Dashboard still submits awards)
- AI — layer on the above
- Media — calendar / kit

## Switching kit

`/migrate` + `@vantage/import`. Dual-run Notion/ICS/Sheets until the team disconnects. STIMS, WPILib, Onshape, Discord are not cloned.

## New feature rule

New capabilities land in a hub tab or domain package. Do not add an orphan `/slug` unless it is wired in `hubs.ts` and has a real compute module.
