# Vantage feature map

| Hub | Route | Tabs |
|---|---|---|
| Competition | `/competition` | Command · My Day · Strategy · Scouting · Form builder · Match checklist · Pick clock · Chemistry (+ More tools) |
| Strategy Soft-UI | `/strategy`, `/strategy/draft`, `/pick-clock`, `/chemistry` | Pick desk / draft board / explainability + coverage links to Scouting, Form builder, Match checklist; empty/setup never invents DEMO metrics |
| Scouting forms | `/scouting/forms` (also `/competition?tab=forms`) | Soft-UI custom form builder (MC / short / free / dropdown / drivetrain / robot image) → `POST /api/scouting/schemas` |
| Scout voice notes | `/competition?tab=scouting` (`#scout-voice`) | Opt-in voice STT notes + optional Apply-to-form; cloud STT metered with UsageCutoffBanner |
| Offline Shell Soft-UI | `/offline`, `/offline-shell` | Cold SW fallover + precache readiness; next actions + Scouting links; Soft-UI banners on Schedule / Scouting / Calendar / Todos / Logistics — never DEMO sync counts |
| Match checklist Soft-UI | `/match-checklist` (also `/competition?tab=match-checklist`) | Timed pit runs/items, empty/setup + next actions; cross-links to Event Day / My Day / Scouting / Strategy — never DEMO checklist progress |
| Displays Soft-UI | `/display`, `/display/kiosk` | Pit TV board setup + kiosk; empty/setup + next actions; cross-links to Event Day / Strategy / Scouting; TBA/prediction widgets stay blank until real rows — never DEMO ranks or coverage zeros |
| Team | `/team` | Calendar · Todos · Messages · Practice · Knowledge · Attendance · Batteries · FMEA (+ More tools) |
| Calendar Soft-UI | `/team?tab=calendar` (also `/team/calendar`) | Month / Week / List clarity, empty/setup + next actions; subteams + events only when created — never DEMO events; cross-links to Practice / Attendance / Logistics / Messages |
| Batteries Soft-UI | `/team?tab=batteries`, `/build?tab=batteries` (also `/batteries`) | Pack list, rotation, health/log empty states, next actions; IR/cycles from real logs only — never DEMO metrics; cross-links to FMEA / Pit / rotation / forecast |
| Knowledge Soft-UI | `/team?tab=knowledge` (also `/team/knowledge`) | Page list filters, empty/setup shells, editor affordances (dirty/char count/md chips); cross-links to Messages / FMEA / CAD; page mutations stay org-scoped — never DEMO articles |
| FMEA Soft-UI | `/team?tab=fmea`, `/build?tab=fmea` (also `/fmea`) | Risk rows with O×S×D + RPN, empty/setup + next actions; cross-links to Knowledge / CAD / Prototypes; RPN only from logged scores — never DEMO numbers |
| Risk Register Soft-UI | `/risks` | Proactive season L×I register (distinct from FMEA); empty/setup + next actions; top score blank until real entries; cross-links to FMEA / Knowledge |
| Goals Soft-UI | `/goals` | Season objectives + scorecard from logged current/target values only; empty/setup + next actions; progress blank until goals exist; cross-links to Todos / Practice / Team hub — never DEMO % |
| Season Costs Soft-UI | `/costs` | Real-world spend + subscriptions + live usage ledger vs season budget; empty/setup + next actions; remaining/% blank until budget set; cross-links to Orders / Fundraisers / Business budget — never DEMO $ |
| Logistics Soft-UI | `/logistics` (also `/travel`) | Hotels, rooming, travel legs, checklist, on-duty mentors; empty/setup states; cross-links to Event Day / My Day / Team calendar; tripId/hotelId org-scoped — never DEMO lodging |
| Business | `/business` | Overview · Budget · Orders · Sponsors · Sponsorship · Grants · … |
| Business Soft-UI CRM | `/business?tab=sponsors` · `/business?tab=placements` | Soft-UI pipeline / packages / placements; empty/setup + next actions; cross-links to fundraisers, grants, orders, Finance-in-AI; packageId org-scoped — never DEMO sponsor metrics |
| Business Soft-UI grants | `/business?tab=grants` · `/team/grants` | Pipeline + draft library + guided grant writing; empty/setup + next actions; metered AI hard-stop via UsageCutoffBanner; cross-links to sponsors / fundraisers / writer — never DEMO award $ |
| Business Soft-UI fundraisers | `/fundraisers` · Overview fundraising glance | Soft-UI events + goal progress from recorded deposits/goals only; empty/setup + next actions; cross-links to Sponsors / Grants / Orders — never DEMO raised totals |
| Business Soft-UI impact & awards | `/impact` · `/team/awards` · Business · Awards | Soft-UI outreach log + readiness from recorded activities; award essays from catalog submissions; empty/setup + next actions; cross-links to Business hub / Grants / Sponsors — never DEMO hours or win rates |
| Build | `/build` | Kickoff · CAD · Code · FMEA · Prototypes · Batteries (+ More tools) |
| Code Coach Soft-UI | `/build?tab=code`, `/ai?tab=code` (also `/code`) | Local free pattern review + teach-not-do lessons; empty/setup + next actions; clear local-vs-metered strip; UsageCutoffBanner on AI hub (metered neighbors); cross-links to CAD / GitHub / AI chat — never invented review findings |
| AI | `/ai` | Chat · Budgets · Writer · Code assist · Memory · Governance · Finance (+ More tools) |
| AI Memory Soft-UI | `/ai?tab=memory` (also `/team/ai-memory`) | Admin opt-in team memory policy + real Neon counts; private vs team-shared clarity; empty/setup/forbidden shells; Chat/Budgets cross-links — never DEMO memories |
| AI Governance Soft-UI | `/ai?tab=governance` (also `/team/ai-policy`) | Feature/tool allowlists, high-cost approvals, spend alerts, Finance-in-AI consent; empty/setup/forbidden shells; Memory/Budgets/Chat cross-links — never DEMO policy stats |
| Finance-in-AI Soft-UI | `/ai?tab=finance` | Admin redaction consent toggle + honest empty/off; cross-links to Governance / Chat / Budgets / Memory — never DEMO ledger totals |

Team admin: `/team/admin`. Redirects: `apps/web/next.config.ts`.

Cross-feature AI: `scouting.team` returns TBA-trusted payloads plus `trustedLabeled` / `fieldCatalog` from published custom schemas; `scouting.schema` exposes the form-builder catalog to strategy/CAD/kickoff/chat (never invents DEMO fields).
