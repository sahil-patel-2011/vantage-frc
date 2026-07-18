# The FRC season workflow in Vantage

How a team runs its season through the app, phase by phase. Every route is org-scoped
(`?orgId=…`) and mobile-friendly; features marked ✦ include an on-demand AI insight panel
(metered, provenance-tracked, grounded only in your own data).

## 1 · Preseason (Sep–Dec)
| Do | Where |
|---|---|
| Recruit, roster, roles | `/team`, `/recruitment` |
| Train new members, track certifications | `/training` |
| Log shop hours from day one (travel eligibility) | `/hours` ✦ + `/hours/kiosk` (shop-door tablet) |
| Meeting attendance & meetings | `/attendance`, `/meetings` |
| Fundraising: sponsors, grants, budget | `/business`, `/fundraisers`, `/team/budgets` |
| Stock the shop: parts, spares, reorder levels | `/inventory` ✦ |

## 2 · Kickoff weekend (early Jan)
The Team 254 / FIRST kickoff-worksheet flow: read rules → score the game → pick a strategy.
| Do | Where |
|---|---|
| Rules Q&A with rule refs; score every action (points vs cycle time → pts/sec) | `/kickoff` ✦ |
| Vote the design priority matrix (weight 1–5, commit/cut) | `/kickoff` ✦ |
| Seed the 8-week milestone plan from kickoff date | `/calendar` ✦ |

## 3 · Build season (weeks 1–6)
| Do | Where |
|---|---|
| Milestones: design freeze → drivetrain rolling → full robot; **remote meetings carry Zoom/Meet/Teams Join buttons** | `/calendar` ✦ |
| Tasks per subteam | `/tasks` |
| CAD iterations & design review | `/cad` |
| BOM per mechanism: can we build it from stock? | `/inventory` ✦ (BOM tab) |
| Engineering notebook | `/notebook` |
| Safety incidents | `/safety` |
| Hours keep accruing | `/hours` ✦ |

## 4 · Pre-competition (week before an event)
| Do | Where |
|---|---|
| Self-inspect vs the FRC checklist; weigh-ins vs limit | `/inspection` ✦ |
| Drive practice: timed cycles, success rates | `/practice` |
| Draw and save match plays | `/whiteboard` |
| Pack the trailer from the standard load-out | `/packing` |
| Battery fleet, event readiness | `/batteries`, `/event-readiness`, `/pit` |

## 5 · Competition day
| Do | Where |
|---|---|
| Everything at a glance | `/command`, `/dashboard` |
| Full match schedule, on-deck countdown, scout coverage | `/schedule` ✦ |
| Rankings + playoff bracket | `/rankings` |
| **One-tap drive-coach briefing: prediction + plan + play + practice + opponent film** | `/briefing` |
| Scout every match (offline-capable) | `/scouting` |
| Predictions, what-ifs, playbooks, pick lists | `/strategy` |
| Opponent intel & research | `/intel`, `/dossier` |
| Pit ops: failures, fixes, release gate | `/pit`, `/repairs` |
| Match debrief: prediction vs actual, lessons | `/match-debrief` |
| Re-watch film with timestamped, tagged notes | `/video` ✦ |
| Judge presentations & awards | `/showcase`, `/awards`, `/mock-judging` |

## 6 · Post-event / offseason
| Do | Where |
|---|---|
| Film review, failure tagging | `/video` ✦ |
| Impact/outreach records | `/impact`, `/awards` |
| Retro + season rollover | `/retro`, `/season-rollover` |
| Exports & audits | `/exports`, `/team/audit` |

## The AI layer (✦)
Eight insight kinds run through the metered `AIOrchestrator` with provenance-classified
sources: practice coach, inspection advisor, stock advisor, kickoff strategist, schedule
risk, video scout summary, engagement digest, prediction accuracy. Deterministic local
provider by default; platform-routed models swap in with zero feature-code changes.

## Efficiency rules of thumb
- **One source of truth per fact** — enter data once where it happens, read it everywhere.
- **Seed, don't type** — kickoff priorities, calendar milestones, inspection checklist, and
  packing lists all start from built-in templates.
- **Everything works by URL** — bookmark the phase you're in.
- **Remote-friendly** — meeting milestones carry Join links so the hub is the one place to look.
