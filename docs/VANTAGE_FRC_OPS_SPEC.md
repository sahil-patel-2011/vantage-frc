# VantageFRC ops spec — FRC pit reliability

**VantageFRC** is the product: a multi-tenant FIRST Robotics Competition operations platform (scouting, pit, inspection, strategy, packing). This spec is VantageFRC feature work for FRC teams.

Evidence for *what goes wrong at events* comes from Chief Delphi pit threads (including 254’s 2026 “Most Common Issues Seen” write-up). That write-up is research input, not the product name.

Never DEMO metrics. Prefer extending existing org-scoped pages. No new routes. No SQL migrations (JSONB, packing template, checklist keys only). The 3-minute copy-build loop is **stopped**.

## Shipped on existing pages

Packing load-out (bumpers, electrical, CANivore, ESD, Kraken screws, intake spares), match checklist (TBA bumper color, SB50, DS laptop, lens wipe, bolt check, Kraken screws, controller-button tape), inspection copilot (BOM, radio/RIO PD, Spark MAX USB, gated 2026 pit reliability walk), power budget breaker/current-limit/stagger cues, wiring diagnoser 4 AWG PDH mains, strategy auto-coordination + backup auto + deploy-vs-stow, battery break-in, I104 reinspect, playoff re-weigh.

## Non-goals

New routes, migrations, DEMO numbers, resurrecting the copy-build loop, or shipping someone else’s STL library as VantageFRC CAD.
