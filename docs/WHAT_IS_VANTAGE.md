# What Vantage is, and who it helps

A plain-language overview for someone opening this repo for the first time. Engineering depth lives in
`README.md`, `docs/ARCHITECTURE.md`, `docs/FEATURE_MAP.md`, and `FRC_WORKFLOW.md`; this page is the
"why does this exist" layer above those.

## The one-line version

**Vantage is the operations platform for an FRC robotics team's whole season** — scouting, match
strategy, event-day command, build-season CAD/code/robot work, team calendar/chat/hours, business and
fundraising, and a metered AI layer on top — delivered as one Next.js app (`apps/web`) with a Windows
desktop shell and a CAD CLI around it.

Marketing headline on the landing page: *"Your FRC team, in one place."*

## The problem it solves

A FIRST Robotics Competition (FRC) team is a small organization run mostly by high-school students and
volunteer mentors, on a brutal calendar:

| Phase | What the team is juggling |
|---|---|
| Preseason (Sep–Dec) | Recruiting, training, shop hours, sponsors, grants, inventory |
| Kickoff (early Jan) | Reading a new game manual, scoring every action, picking a strategy, planning 6–8 weeks |
| Build season | CAD iterations, BOM vs stock, tasks per subteam, engineering notebook, safety |
| Pre-competition | Self-inspection, weigh-ins, drive practice, packing the trailer, batteries |
| Competition day | Match schedule, scouting every match, rankings, predictions, pick lists, pit repairs |
| Off-season | Awards, outreach, season report, graduating seniors handing off knowledge |

Today most teams glue this together out of Google Sheets, Discord, Notion, paper scouting forms, a
spreadsheet of batteries, and someone's memory. Vantage gives each team **one org-scoped workspace** that
already knows the FRC calendar, pulls real event data from The Blue Alliance / Statbotics, and refuses to
show fake numbers when real data isn't there yet.

## Who it helps

The product is built around the roles found on a real FRC team. Every member belongs to one
**organization** (the team) with an `org_role` of `owner`, `admin`, `scout`, or `viewer`, and onboarding
asks who you are (`student | mentor | coach | parent | other`), a focus track (`competition | build |
business | leadership`), and a subteam (mechanical, electrical, programming, CAD, drive team, scouting,
business, safety — `apps/web/lib/role-onboarding/assign.ts`). The public `/for-teams` page frames it as four
audiences: **Mentors & coaches · Drive & strategy · Scouts & pit · Business leads**.

| Person | What they get from Vantage |
|---|---|
| **Students** (build, CAD, code, business, media crews) | Team calendar with real match times, team chat, task board, shop-hours clock-in, knowledge wiki/playbook, Onshape CAD agent, Code Coach + Bugbot for robot code |
| **Scouts** | Offline-capable scouting forms (QR / P2P relay / outbox sync), pit scouting defaults, voice notes, shift balancer, pairwise ranking, drive-team tags |
| **Drive team & strategy lead** | Match predictions, pick-list desk, alliance-selection board, match strategy cards, defense planner, one-tap drive-coach briefing, match debrief |
| **Pit crew** | Match checklist (bumpers, SB50, DS laptop…), pit repair triage with FMEA, battery rotation, spare forecast, inspection copilot, weigh-in log |
| **Mentors / coaches (owners, admins)** | Roster + invites, role/hub access control, attendance, travel/lodging logistics, packing lists, risk register, readiness score, AI spend caps |
| **Business / outreach students & parents** | Budget, purchase orders, sponsor CRM, grant pipeline + AI-assisted grant writing, fundraisers, impact/awards log, media calendar |
| **Team leadership across seasons** | Season playbook, decision log, exit interviews → wiki handoff, season report, "Bring your season" importer (ICS / CSV / Notion) |
| **Platform operators (Vantage staff)** | `/admin` Global Team Manager: provision teams, connectors, model catalog, plans, partners, support, audit — gated by a `platform_admins` row |

Teams are **provisioned, not self-signup**: a platform admin creates the org and a verified owner; owners and
admins then invite exact emails. Everyone else lands on a waitlist. (A verified-email `/claim` path exists
for an unused TBA team number.)

## The six hubs

The UI is organized as jobs, not a feature catalog (`apps/web/lib/nav/hubs.ts`):

| Hub | Route | Inner tabs |
|---|---|---|
| **Competition** | `/competition` | Event day · Scouting · Strategy · Pit |
| **Team** | `/team` | Calendar · Chat · People · Work · Playbook |
| **Build** | `/build` | Kickoff · CAD · Code · Robot |
| **Business** | `/business` | Overview · Money · Sponsors · Grants · Outreach |
| **AI** | `/ai` | Chat · Writer · Agent · Controls · Notes |
| **Media / Logistics** | `/media`, `/logistics` | Content calendar; travel, packing, duties |

`docs/FEATURE_MAP.md` lists every route with its data-honesty rule (e.g. "never DEMO win rates").

## What makes it different (the rules the code actually enforces)

1. **No invented metrics, ever.** Every widget shows a setup/empty state until real rows exist. The
   feature map repeats "never DEMO …" on nearly every line, and tests assert it.
2. **Tenancy is the security model.** Every request goes through `withRls({ userId, orgId })`, Postgres
   row-level security does the filtering, and product code is lint-blocked from the worker DB role.
3. **AI is metered and grounded.** Every model call goes through `meteredAI` → billing ledger → spend caps.
   Teams bring their own keys (OpenAI / Anthropic / Google / OpenRouter / local Ollama) or use hosted plans.
   AI features only reason over the team's own data plus the TBA cache.
4. **TBA is a shared cache, not a per-team poller.** One ingest worker refreshes platform reference tables
   (events, teams, matches, OPRs, rankings, Statbotics EPA); every team reads from Postgres.
5. **Works offline at the event.** Scouting has a service-worker shell, IndexedDB outbox, QR hand-off, and a
   BroadcastChannel pit mesh because venue Wi-Fi is unreliable.
6. **Honest degradation.** Integrations that need env vars (Onshape, Stripe, Resend, GitHub OAuth, Twilio,
   Notion, TBA key) show a "configure X" state instead of crashing.

## Integrations

| System | Role in Vantage |
|---|---|
| The Blue Alliance + Statbotics | Official event/match/ranking data and EPA ratings (read into the shared cache) |
| Onshape (OAuth / API keys) & Fusion 360 (local add-in) | CAD agent: sketch/extrude features from chat; Claude Code MCP via `npx vantage-cad` |
| GitHub (PAT or OAuth) | Read-only robot-code context for Bugbot / Code Coach; due dates on the calendar |
| Google | Sign-in (Better Auth) |
| Resend | Email OTP / 2FA / password reset transport |
| Stripe | Subscriptions + hosted credit packs |
| Anthropic / OpenAI / Google / OpenRouter / Ollama | Configurable AI routing, BYO keys encrypted per org (KMS envelope) |
| Slack / Discord | Optional team-chat bridge |
| Notion / ICS / CSV | "Bring your season" import |

## Pricing (defaults in `packages/billing/src/catalog.ts`)

Free · Access $69 · Individual Pro $109 · Individual Max $159 · Team Pro $299 · Team Max $549 per month,
plus pay-as-you-go credit packs and a one-week team trial. Plans bundle an included AI allowance; usage is
an append-only ledger, not a counter.

## Where to look next

- Run it: `npm run dev` → http://localhost:3001 (no DB → setup/empty states everywhere, still boots).
- Season walkthrough: `FRC_WORKFLOW.md`.
- Every route and its honesty rule: `docs/FEATURE_MAP.md`.
- Engineering constraints: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `SECURITY_OPERATIONS.md`.
- Health of the codebase and what to do next: `docs/CODEBASE_PLAN.md`.
