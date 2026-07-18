# Vantage feature map — where things live

Single map of product surfaces for humans and agents. Nav labels come from
`apps/web/lib/nav/product-nav.ts` (app shell drawer + ⌘K + breadcrumb helper).

## Pillars

| Pillar | Job | Primary routes |
|---|---|---|
| **Home** | Daily landing + workspace switcher | `/dashboard`, `/start` (role/subteam onboarding path), `/workspace`, `/announcements` |
| **Competition** | Event-day ops, scouting, pit, match flow, kickoff | `/command`, `/my-day`, `/scouting`, `/scouting/lineup`, `/intel`, `/schedule`, `/pick-clock`, `/chemistry`, `/dossier`, `/rankings`, `/video`, `/pit`, `/batteries`, `/incidents`, `/match-checklist`, `/briefing`, `/match-debrief`, `/inspection`, `/kickoff` |
| **Team** | People ops + calendar (dated work) | `/team/calendar`, `/calendar`, `/practice`, `/shifts`, `/attendance`, `/hours`, `/tasks` (Todos), `/messages`, `/goals`, `/risks`, `/roles`, `/team/knowledge`, `/team/alumni`, `/team`, `/team/discord`, `/team/data` |
| **Logistics** | Get-there-and-back trip times, lodging, packing, duties, visit invites | `/logistics`, `/packing`, `/duties`, `/visit-invites` (+ Team Calendar → My trip) |
| **Business** | Money, sponsors, awards, impact, exports | `/business`, `/orders`, `/costs`, `/team/finance`, `/team/sponsors`, `/sponsorship`, `/team/grants`, `/team/awards`, `/fundraisers`, `/impact`, `/recognition`, `/exports` |
| **Build** | Robot design/build tooling | `/cad`, `/code`, `/robot`, `/subsystems`, `/fmea`, `/display`, `/inventory`, `/vendors`, `/control-map`, `/software-versions`, `/decisions` |
| **AI** | Assistant + strategy + writers + usage | `/chat`, `/strategy`, `/writer`, `/team/usage` |
| **Settings** | Account + org security + budgets | `/account`, `/help`, `/notifications`, `/security`, `/team/security`, `/team/budgets` |

Bottom island tabs: **Home · Event · Scout · Team** (+ More sheet → My Day glance, pillar shortcuts, unread badges; Full menu → drawer).

## Team vs Competition vs Logistics vs Business vs AI

- **Team** = people continuity **and** dated work (calendar, practice, shifts, attendance, hours, todos, messages).
- **Competition** = at-the-event execution **and** scouting/intel (command, My Day, pit, matches, pick desk).
- **Logistics** = timed leave/hotel/venue/return legs, lodging, packing, duties, visit invites (sibling to Competition; trip times also on `/team/calendar` → My trip).
- **Business** = fundraising, sponsors, costs, community impact — not “team admin”.
- **AI** = Vantage chat, strategy assist, award writer, metered usage — not a laundry list of every AI touchpoint.

Cross-links inside Team surfaces use `TeamOpsNav`
(`apps/web/components/team-ops-nav.tsx`): Your path · Practice · Todos · Messages · Calendar · Attendance · Goals · Admin.

## Role onboarding (CD #28)

| Route | What it is |
|---|---|
| `/start` | Personal Soft-UI checklists auto-assigned from `team_role`, `primary_focus`, and calendar subteam membership |
| `/team/getting-started` | Org-wide workspace setup signals (invites, knowledge, budgets) — not the personal path |

Templates live in `apps/web/lib/role-onboarding/`; progress in `member_onboarding_*` (migration `0163`).

## Two calendars (intentional)

| Route | What it is |
|---|---|
| `/team/calendar` | Subteam / practice / build / meeting calendar (default Calendar / Team tab) |
| `/calendar` | Season milestones (kickoff, stop-build, events) |

Deep links between them live in `apps/web/lib/subteam-calendar.ts` (`eventWorkflowLinks`).

## Todos vs Tasks

| Route | Status |
|---|---|
| `/tasks` | Live Todos board (nav + TeamOps) |
| `/todos` | Soft-UI package in progress — flip nav here when the page ships |

## Legacy redirects (dead-end cleanup)

Configured in `apps/web/next.config.ts`:

| From | To | Why |
|---|---|---|
| `/knowledge` | `/team/knowledge` | Knowledge lives under Team |
| `/repairs` | `/incidents` | Repair / failure log |
| `/meetings` | `/team/calendar` | Meetings are calendar events |
| `/config` | `/robot` | Robot blueprint / configuration |
| `/changes` | `/decisions` | Decision / change history |

Planned (shown disabled in nav, no page yet): Parts Relay, Training Matrix, Leadership Continuity, Retrospective, Season Rollover, Mock Judging.

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
| Season + subteam calendars | Team |
| Business / impact / awards | Business |
| Vantage AI / strategy / writer | AI |
