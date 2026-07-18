# Vantage feature map — where things live

Product chrome and drawer IA: `apps/web/lib/nav/product-nav.ts` (`apps/web/components/app-shell.tsx`).
Hub tab definitions (in-feature subnav): `apps/web/lib/nav/hubs.ts`.

## Navigation pillars (drawer + More sheet)

| Pillar | Role | Example routes |
|---|---|---|
| **Home** | Workspace entry, announcements, onboarding path | `/dashboard`, `/start`, `/workspace` |
| **Competition** | Event day, scouting, intel, pit, match ops | `/command`, `/my-day`, `/scouting`, `/intel`, `/pit` |
| **Team** | People, calendar, practice, messages, todos | `/team/calendar`, `/messages`, `/tasks`, `/attendance` |
| **Logistics** | Travel, packing, duties, visit invites | `/logistics`, `/packing`, `/duties`, `/visit-invites` |
| **Business** | Budget, sponsors, orders, grants, awards | `/business`, `/sponsorship`, `/orders` |
| **Build** | CAD, code, FMEA, repairs, batteries | `/cad`, `/code`, `/fmea`, `/batteries` |
| **AI** | Vantage AI chat, strategy, writer, usage | `/chat`, `/strategy`, `/writer`, `/team/usage` |
| **Settings** | Account, security, team admin, help | `/account`, `/security`, `/team`, `/help` |

Bottom island (mobile): **Home · Event · Scout · Team · More** (`PRIMARY_TABS` + More sheet).
More sheet quick links: My Day, Messages, Logistics, Business, Build, AI.

Legacy redirects live in `apps/web/next.config.ts` (orgId preserved). Exact `/cad` redirects; `/cad/pair` stays.

## Role onboarding (CD #28)

| Route | What it is |
|---|---|
| `/start` | Personal Soft-UI checklists auto-assigned from `team_role`, `primary_focus`, and calendar subteam membership |
| `/team/getting-started` | Org-wide workspace setup signals (invites, knowledge, budgets) — not the personal path |

Templates live in `apps/web/lib/role-onboarding/`; progress in `member_onboarding_*` (migration `0163_role_onboarding`).
