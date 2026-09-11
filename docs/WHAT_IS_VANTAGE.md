# What Vantage is

*For anyone meeting Vantage for the first time — students, mentors, parents, sponsors. No
engineering background needed. Last reviewed September 2026.*

## In one sentence

Vantage is one place for everything a FIRST Robotics Competition team does — learning, building,
competing and running the team as an organization — with AI as a helper that shows its work.

## The problem it solves

An FRC team is a small organization run mostly by high-school students and volunteer mentors, on a
demanding calendar:

| Phase | What the team is juggling |
|---|---|
| Preseason (Sep–Dec) | Recruiting, training new members, shop hours, sponsors, grants, inventory |
| Kickoff (January) | Reading a brand-new game, scoring every action, choosing a strategy, planning six weeks |
| Build season | CAD iterations, parts and orders, tasks per subteam, the engineering notebook, safety |
| Pre-competition | Self-inspection, weigh-ins, drive practice, packing, batteries |
| Competition | Match schedule, scouting every match, rankings, predictions, pick lists, pit repairs |
| Off-season | Awards, outreach, the season report, seniors handing off what they know |

Most teams run this on Google Sheets, Discord, a shared drive, paper scouting forms and someone's
memory. New members need five accounts before they can help. Vantage gives the team one login that
already knows the FRC season, pulls real event data automatically, and works in a pit with no Wi-Fi.

## Who it is for

Everyone on the team signs in to the same place and sees what is relevant to them.

| Person | What Vantage does for them |
|---|---|
| **New members** | Learning tracks (laptop setup, Git and WPILib, Onshape basics), the team playbook, and a Home dashboard that shows what to do next |
| **Students on build, CAD, code and business crews** | Tasks, calendar, chat, shop-hours clock-in, files, CAD tools, code help and Bugbot, the parts catalog |
| **Scouts** | Forms that work offline, QR hand-off between tablets, coverage and data-quality views |
| **Drive team and strategy** | Match predictions with their reasoning, match strategy cards, alliance selection, opponent watchlist, a 20-second pre-match briefing |
| **Pit crew** | Match checklist, repair triage, battery rotation, inspection help |
| **Mentors and coaches** | Roster and invites, attendance, hours, duties, logistics, budget approvals, readiness — and the same views students see |
| **Business and outreach** | Budget and purchases, sponsors, grants, outreach hours by person, awards, the impact record |

### Roles and access

A team is an *organization* in Vantage. Each member has a role — **owner**, **admin**, **scout** or
**viewer** — and owners and admins decide who can do what. Onboarding also asks each person who they
are (student, mentor, coach, parent) and which subteam they are on, so Home starts out useful.

Access is by invitation: an owner or admin invites members by email. A team is set up by the Vantage
platform team; anyone else who signs up joins a waitlist.

### Every kind of team

Onboarding asks how the team is funded — self-funded, school-funded with no sponsors, sponsored, or
school-related and sponsored — and the Business workspace adapts. A school team that cannot take
sponsors never sees sponsor tools; a self-funded team sees dues and fundraisers first.

## How the app is organized

Signed in, you land on **Home** — a dashboard you arrange yourself from a library of widgets (next
match prediction, tasks due, files, hours, budget, and more), with sensible defaults for students and
for mentors. From there, four workspaces:

| Workspace | Sections |
|---|---|
| **Competition** | Event day · Scouting · Strategy · Pit |
| **Team** | Calendar · Chat · People · Work · Playbook |
| **Build** | Kickoff · CAD · Code · Robot |
| **Business** | Overview · Money · Sponsors · Grants · Outreach |

Related tools live as tabs inside each section, so nothing is more than two clicks from a workspace.
**Ask AI** is a single button on every page. **Files**, **Logistics** and **Settings** are in the
menu.

## What makes it different

**It works when the Wi-Fi does not.** Competition venues have unreliable networks. Every page keeps
the last thing it loaded on the device and shows it the moment you open it, with the time it was
saved. Things you change while offline — a scouting entry, a ticked task, a clock-in — wait in a queue
and upload when the connection comes back.

**It never invents a number.** If a screen has no real data yet, it says what is missing and what to
do about it. There are no placeholder statistics anywhere, and tests enforce that.

**Your team's data is yours.** Every team's rows are separated by the database itself (Postgres
row-level security), not just by the app. Everything can be exported.

**AI is a helper, not the product.** Ask AI answers from your team's own data and public event data,
shows what it read, and says when it does not know. It runs, in order of preference, on hardware the
team owns (a paired Raspberry Pi relay), then on the team's own model keys, then on a hosted key —
and it always tells you which one answered. AI usage is metered and capped so a team is never
surprised.

**It knows the FRC calendar.** Match schedules, results, rankings and team statistics come from
The Blue Alliance and Statbotics through one shared cache, refreshed for everyone, so no team hammers
those services.

## Integrations

| Service | What it does in Vantage |
|---|---|
| The Blue Alliance, Statbotics | Event, match, ranking and team statistics |
| Onshape | CAD vault, design tools, the assembly manual; works with a pasted link or a full account connection |
| Fusion 360 | CAD tools through a relay that runs on the team's own laptop |
| GitHub | Robot-code repository for Bugbot, code help and calendar milestones |
| Google | Sign-in with a school or personal Google account |
| Discord, Slack | Announcements and a team-chat bridge |
| Email (Resend) | Sign-in codes, invitations, reminders |
| Stripe | Billing, when a deployment enables paid plans |
| Team storage node, Pi relay, Fusion relay | Optional hardware the team owns, paired with a code |

Every integration works in a reduced form without credentials — for example, Onshape documents can
be added by link before an account is connected — and the app says exactly what to set up to unlock
the rest.

## Platforms

- **Web:** any modern browser, on a laptop or a phone.
- **Desktop:** Windows (MSI, installer or portable) and macOS (DMG). The desktop app is the same
  product in a native window, always in sync with the web, with the Fusion 360 relay built in.
- **Offline:** the web app installs as a progressive web app and keeps working without a connection.

## Cost

The hosted version at https://vantage-frc-web.vercel.app is free to use. Teams that want to run
their own copy can; the code is public. Plan and credit definitions exist in the codebase for
deployments that choose to enable billing (see [PRICING.md](PRICING.md)).

## Where to go next

- The season, phase by phase: [SEASON_WORKFLOW.md](SEASON_WORKFLOW.md)
- Every screen: [FEATURE_MAP.md](FEATURE_MAP.md)
- The desktop app: [DESKTOP.md](DESKTOP.md)
- Running your own copy: [SELF_HOSTING.md](SELF_HOSTING.md)
- How it is built: [ARCHITECTURE.md](ARCHITECTURE.md)
