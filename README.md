# Vantage

**One login for everything an FRC team does.**

Vantage is a free, open-source operations platform for FIRST Robotics Competition teams. It replaces
the pile of spreadsheets, group chats, shared drives and paper scouting forms a team usually runs on
with one place that already knows the FRC season — and it teaches new members on the way in.

[![Web CI](https://github.com/sahil-patel-2011/vantage-frc/actions/workflows/web.yml/badge.svg)](https://github.com/sahil-patel-2011/vantage-frc/actions/workflows/web.yml)

| | |
|---|---|
| **Use it now** | https://vantage-frc-web.vercel.app — hosted, free, nothing to install |
| **What it does** | [docs/WHAT_IS_VANTAGE.md](docs/WHAT_IS_VANTAGE.md) — plain-language tour |
| **All documentation** | [docs/README.md](docs/README.md) — organized by who you are |
| **Run your own copy** | [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) |
| **Contribute** | [CONTRIBUTING.md](CONTRIBUTING.md) |

## Try the hosted version first (recommended)

The easiest way to use Vantage is the version we host at **https://vantage-frc-web.vercel.app**.
It is free, and everything — database, sign-in, integrations, background jobs — is already set up.
Sign up there and your team can start the same day.

Self-hosting is for teams that specifically want to run their own copy on their own accounts. It
works, and the whole codebase is open, but it means creating a Postgres database, a Vercel project
and the provider credentials yourself. If that is you, start at
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## What is inside

Vantage is organized around the jobs a team actually does, not a feature list. Signed in, you get a
**Home** dashboard you can arrange yourself, four workspaces, and an **Ask AI** button on every page.

| Workspace | What lives there |
|---|---|
| **Competition** | Event day command, match schedule and rankings, scouting (works offline), match prediction and strategy, alliance selection, pit checklist and repair triage |
| **Team** | Calendar, team chat, people and attendance, shop hours, tasks and duties, the team playbook and files |
| **Build** | Kickoff planning, CAD (Onshape and Fusion 360), robot code and Bugbot, robot readiness, inspection, batteries |
| **Business** | Budget and purchases, sponsors, grants, outreach and impact hours, awards |
| **Ask AI** | One place to ask about your team's data — strategy, design, code, writing — that shows its sources and says when it does not know |

Also: **Files** (a team drive with sharing), **Logistics** (travel, packing, duties), learning tracks
for new members (laptop setup, Git and WPILib, Onshape), a desktop app for Windows and macOS, and an
offline mode that keeps every page on the last thing it loaded when venue Wi-Fi drops.

The full list of screens is in [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md).

## How it is different

- **It works when the Wi-Fi does not.** Every page keeps its last snapshot on the device, writes
  queue up, and scouting has its own outbox, QR hand-off and pit-to-pit mesh.
- **It never invents a number.** An empty screen says what is missing and what to do — never a
  placeholder statistic.
- **Your team's data is yours.** Each team's rows are isolated by Postgres row-level security, and
  everything can be exported.
- **AI is a helper, not the product.** It answers from your team's own data and public event data,
  shows what it read, and can run on hardware you own (a Raspberry Pi relay) before it ever touches a
  paid key.
- **It knows the FRC calendar.** Schedules, results and rankings come from The Blue Alliance and
  Statbotics through one shared cache, so no team hammers those APIs.

## How it is built

- **Web app:** Next.js (App Router) in `apps/web`, deployed on Vercel. This is the only deployment.
- **Database:** PostgreSQL (Neon for the hosted version — [docs/NEON.md](docs/NEON.md)). Postgres is the only datastore; tenancy is
  enforced by row-level security, and the schema is a numbered series of append-only SQL migrations.
- **Desktop:** `apps/desktop`, an Electron shell around the hosted app with Windows (MSI, installer,
  portable) and macOS (DMG) builds.
- **Optional team hardware:** a storage node for large files, a Raspberry Pi relay for AI, and a
  Fusion 360 relay — all paired to a team with a code, never exposed to the internet.
- **Packages:** shared logic lives in `packages/*` (database, auth and tenancy, billing, reference
  data, scouting, prediction, CAD, agents, import/export). See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Working on the code

```sh
npm install            # Node 22+
npm run dev            # http://localhost:3001 (boots without a database; product screens show setup states)
npm run typecheck && npm run lint && npm test
npm run build --workspace=@vantage/web
npx playwright install chromium   # once per machine
npm run test:browser              # Playwright vs http://127.0.0.1:3310 (E2E_AUTH_FIXTURE, local vantage_ci)
```

Conventions, verification and the pull-request checklist are in
[CONTRIBUTING.md](CONTRIBUTING.md). If you are an AI coding agent, read [CLAUDE.md](CLAUDE.md) first.

## Project status

Vantage is in active development and used by its author's team. What is proven, what is in progress
and what is still owner-blocked is kept honestly in [docs/STATUS.md](docs/STATUS.md). Match
prediction accuracy, in particular, is reported in
[docs/PREDICTION_RESULTS.md](docs/PREDICTION_RESULTS.md) and is not yet a validated claim.

## License and community

Vantage is **[MIT License](LICENSE)** (SPDX `MIT`). The npm `"private": true` field only means
this monorepo is not published to the npm registry; it does not block self-hosting.

- [Contributing](CONTRIBUTING.md) — local run, Neon path, tenancy rules, how to help
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security](SECURITY.md) — private reports; do not file public issues for secrets or RLS bugs
- Issue templates: `.github/ISSUE_TEMPLATE/` · PR template: `.github/PULL_REQUEST_TEMPLATE.md`
- Hosted Postgres path: [docs/NEON.md](docs/NEON.md)
