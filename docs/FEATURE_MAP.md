# Vantage feature map

| Hub | Route | Tabs |
|---|---|---|
| Competition | `/competition` | Command · My Day · Strategy · Scouting · Form builder · Match checklist · Pick clock · Chemistry (+ More tools) |
| Strategy Soft-UI | `/strategy`, `/strategy/draft`, `/pick-clock`, `/chemistry` | Pick desk / draft board / explainability + coverage links to Scouting, Form builder, Match checklist; empty/setup never invents DEMO metrics |
| Scouting forms | `/scouting/forms` (also `/competition?tab=forms`) | Soft-UI custom form builder (MC / short / free / dropdown / drivetrain / robot image) → `POST /api/scouting/schemas` |
| Scout voice notes | `/competition?tab=scouting` (`#scout-voice`) | Opt-in voice STT notes + optional Apply-to-form; cloud STT metered with UsageCutoffBanner |
| Match checklist Soft-UI | `/match-checklist` (also `/competition?tab=match-checklist`) | Timed pit runs/items, empty/setup + next actions; cross-links to Event Day / My Day / Scouting / Strategy — never DEMO checklist progress |
| Team | `/team` | Calendar · Todos · Messages · Practice · Knowledge · Attendance · Batteries · FMEA (+ More tools) |
| Batteries Soft-UI | `/team?tab=batteries`, `/build?tab=batteries` (also `/batteries`) | Pack list, rotation, health/log empty states, next actions; IR/cycles from real logs only — never DEMO metrics; cross-links to FMEA / Pit / rotation / forecast |
| Knowledge Soft-UI | `/team?tab=knowledge` (also `/team/knowledge`) | Page list filters, empty/setup shells, editor affordances (dirty/char count/md chips); cross-links to Messages / FMEA / CAD; page mutations stay org-scoped — never DEMO articles |
| FMEA Soft-UI | `/team?tab=fmea`, `/build?tab=fmea` (also `/fmea`) | Risk rows with O×S×D + RPN, empty/setup + next actions; cross-links to Knowledge / CAD / Prototypes; RPN only from logged scores — never DEMO numbers |
| Logistics Soft-UI | `/logistics` (also `/travel`) | Hotels, rooming, travel legs, checklist, on-duty mentors; empty/setup states; cross-links to Event Day / My Day / Team calendar; tripId/hotelId org-scoped — never DEMO lodging |
| Business | `/business` | Overview · Budget · Orders · Sponsors · Sponsorship · Grants · … |
| Business Soft-UI CRM | `/business?tab=sponsors` · `/business?tab=placements` | Soft-UI pipeline / packages / placements; empty/setup + next actions; cross-links to fundraisers, grants, orders, Finance-in-AI; packageId org-scoped — never DEMO sponsor metrics |
| Build | `/build` | Kickoff · CAD · Code · FMEA · Prototypes · Batteries (+ More tools) |
| AI | `/ai` | Chat · Budgets · Writer · Code assist · Memory · Governance · Finance (+ More tools) |

Team admin: `/team/admin`. Redirects: `apps/web/next.config.ts`.

Cross-feature AI: `scouting.team` returns TBA-trusted payloads plus `trustedLabeled` / `fieldCatalog` from published custom schemas; `scouting.schema` exposes the form-builder catalog to strategy/CAD/kickoff/chat (never invents DEMO fields).
