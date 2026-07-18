# Vantage feature map

| Hub | Route | Tabs |
|---|---|---|
| Competition | `/competition` | Command · My Day · Strategy · Scouting · Form builder · Match checklist · Pick clock · Chemistry (+ More tools) |
| Strategy Soft-UI | `/strategy`, `/strategy/draft`, `/pick-clock`, `/chemistry` | Pick desk / draft board / explainability + coverage links to Scouting, Form builder, Match checklist; empty/setup never invents DEMO metrics |
| Scouting forms | `/scouting/forms` (also `/competition?tab=forms`) | Soft-UI custom form builder (MC / short / free / dropdown / drivetrain / robot image) → `POST /api/scouting/schemas` |
| Scout voice notes | `/competition?tab=scouting` (`#scout-voice`) | Opt-in voice STT notes + optional Apply-to-form; cloud STT metered with UsageCutoffBanner |
| Match checklist | `/match-checklist` (also `/competition?tab=match-checklist`) | Pre-match timed pit checklist |
| Team | `/team` | Calendar · Todos · Messages · Practice · Knowledge · Attendance · Batteries · FMEA (+ More tools) |
| Business | `/business` | Overview · Budget · Orders · Sponsors · Sponsorship · Grants · … |
| Build | `/build` | Kickoff · CAD · Code · FMEA · Prototypes · Batteries (+ More tools) |
| AI | `/ai` | Chat · Budgets · Writer · Code assist · Memory · Governance · Finance (+ More tools) |

Team admin: `/team/admin`. Redirects: `apps/web/next.config.ts`.

Cross-feature AI: `scouting.team` returns TBA-trusted payloads plus `trustedLabeled` / `fieldCatalog` from published custom schemas; `scouting.schema` exposes the form-builder catalog to strategy/CAD/kickoff/chat (never invents DEMO fields).
