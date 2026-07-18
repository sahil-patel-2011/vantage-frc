# Vantage feature map — where things live

Single map of product surfaces for humans and agents. Nav labels come from
`apps/web/lib/nav/product-nav.ts` (app shell drawer + ⌘K + breadcrumb helper).

## Pillars

| Pillar | Job | Primary routes |
|---|---|---|
| **Home** | Daily landing + workspace switcher + AI | `/dashboard`, `/workspace`, `/chat`, `/announcements` |
| **Competition** | Event-day ops, pit, match flow | `/command`, `/pit`, `/batteries`, `/incidents`, `/match-checklist`, `/intel`, `/schedule`, `/briefing`, `/match-debrief`, `/inspection` |
| **Scouting** | Collect + use match intel | `/scouting`, `/scouting/lineup`, `/strategy`, `/pick-clock`, `/chemistry`, `/dossier`, `/rankings`, `/video` |
| **Calendar** | Time: team calendar, season milestones, practice, shifts, attendance, hours | `/team/calendar`, `/calendar`, `/practice`, `/shifts`, `/attendance`, `/hours` |
| **Build** | Robot design/build tooling | `/cad`, `/code`, `/robot`, `/subsystems`, `/fmea`, `/display`, `/inventory`, `/vendors`, `/control-map`, `/software-versions` |
| **Team** | People ops, todos, knowledge, admin | `/todos`, `/tasks`, `/messages`, `/goals`, `/risks`, `/roles`, `/team/knowledge` (wiki + assistant summary + decision/review search), `/team/alumni`, `/team` (`#github-connection`), `/team/data`, `/team/usage` |
| **Logistics** | Travel / packing / duty roster at events | `/logistics`, `/packing`, `/duties` |
| **Kickoff** | Season start / game manual | `/kickoff` |
| **Business** | Money, sponsors, awards, impact, exports | `/business`, `/costs`, `/team/finance`, `/team/sponsors`, `/team/grants`, `/team/awards`, `/fundraisers`, `/impact`, `/writer`, `/recognition`, `/exports` |
| **Settings** | Account + org security + budgets | `/account`, `/help`, `/notifications`, `/security`, `/team/security`, `/team/budgets` |

Bottom island tabs: **Home · Event Day · Scout · Calendar** (+ More → full drawer).

## Calendar vs Team vs Competition vs Business

- **Calendar** = anything dated (team/subteam calendar, season milestones, practice planner, shifts, attendance roll, build hours).
- **Team** = people and org continuity (todos, messages, goals, risks, roles, knowledge, alumni, admin).
- **Competition** = at-the-event execution (command, pit, batteries, incidents, checklists, matches).
- **Logistics** = packing, duties, event logistics (sibling to Competition).
- **Business** = fundraising, sponsors, costs, awards writing, community impact — not “team admin”.

Cross-links inside Calendar/Team surfaces use `TeamOpsNav`
(`apps/web/components/team-ops-nav.tsx`): Practice · Todos · Messages · Calendar · Attendance · Goals · Admin.

## Two calendars (intentional)

| Route | What it is |
|---|---|
| `/team/calendar` | Subteam / practice / build / meeting calendar (default Calendar tab) |
| `/calendar` | Season milestones (kickoff, stop-build, events) |

Deep links between them live in `apps/web/lib/subteam-calendar.ts` (`eventWorkflowLinks`).

## Todos vs Tasks

| Route | Status |
|---|---|
| `/todos` | Soft-UI Team todos (nav + TeamOps) |
| `/tasks` | Build-season task board (linked from Todos) |

## Legacy redirects (dead-end cleanup)

Configured in `apps/web/next.config.ts`:

| From | To | Why |
|---|---|---|
| `/knowledge` | `/team/knowledge` | Knowledge lives under Team |
| `/repairs` | `/incidents` | Repair / failure log |
| `/meetings` | `/team/calendar` | Meetings are calendar events |
| `/config` | `/robot` | Robot blueprint / configuration |
| `/changes` | `/decisions` | Decision / change history |

Planned (shown disabled in nav, no page yet): Event Travel, Parts Relay, Training Matrix, Leadership Continuity, Retrospective, Season Rollover, Mock Judging.

## Org context

Nav links append `?orgId=` via `withOrgHref` except account/platform chrome
(`/dashboard`, `/account`, `/security`, `/admin`, `/notifications`, `/help`).
Breadcrumbs: `breadcrumbForPath(pathname)` from `product-nav.ts`.

## Package ↔ UI (quick)

| Package / area | UI home |
|---|---|
| GitHub AI context (`0112`, `apps/web/lib/github`) | `/team#github-connection` — see `docs/GITHUB_CONNECTION.md` |
| `packages/scouting` | `/scouting` |
| `packages/prediction-strategy` | `/strategy`, `/pick-clock`, `/chemistry`, `/rankings` |
| `packages/intel-research` | `/intel`, `/dossier` |
| `packages/cad` | `/cad` |
| `packages/billing` | `/team/usage`, `/team/budgets` |
| `packages/export-center` | `/exports` |
| Pit / batteries / incidents | Competition |
| Season + subteam calendars | Calendar |
| Business / impact / awards | Business |
