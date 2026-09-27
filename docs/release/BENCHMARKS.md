# Specialist workflow benchmarks

Reviewed 2026-09-26. Source review is bounded evidence of implementation choices, not a usability or reliability benchmark. No superiority claim is established. Measurements below remain pending.

## Lovat collection code walkthrough

Reviewed the public collection client at commit [012e620](https://github.com/HighlanderRobotics/lovat-collection/tree/012e62021f9f65a6fff50fffb284a9c5791e78df). Scope: report state, report/event types, game actions/timer/template, fuel controls, completed-report history, report migrations and submission. This is not a review of every repository file or the hosted backend. Vantage implements these behaviors independently; no Lovat source or assets were copied into the application.

The [report store](https://github.com/HighlanderRobotics/lovat-collection/blob/012e62021f9f65a6fff50fffb284a9c5791e78df/lib/collection/reportStateStore.ts) records a report UUID, start time and timestamped actions with types, positions and optional quantities. The report serializes times relative to the match start. Duration behaviors pair start and stop observations; undo recognizes those pairs. This supports an inspectable timeline rather than only a final counter value.

The [game view](https://github.com/HighlanderRobotics/lovat-collection/blob/012e62021f9f65a6fff50fffb284a9c5791e78df/lib/collection/ui/Game.tsx) changes available actions with phase and field context. The client contains literal transition times; those are implementation observations, not verified official season rules. Vantage must use validated season/form timing and retain custom forms.

[Fuel controls](https://github.com/HighlanderRobotics/lovat-collection/blob/012e62021f9f65a6fff50fffb284a9c5791e78df/lib/collection/ui/actions/FuelActions.tsx) support tap/drag or held counting, haptic feedback and paired scoring/feeding events. Those interactions need timed usability trials before choosing a Vantage default. Accessible tap controls and an inspectable correction history remain required.

[Completed history](https://github.com/HighlanderRobotics/lovat-collection/blob/012e62021f9f65a6fff50fffb284a9c5791e78df/lib/storage/historyStore.ts) persists reports keyed by UUID and tracks upload state. [Submission](https://github.com/HighlanderRobotics/lovat-collection/blob/012e62021f9f65a6fff50fffb284a9c5791e78df/app/game/submit.tsx) attempts upload, retains unsuccessful reports and displays a QR transfer. This alone does not establish crash recovery for an active report. [Migrations](https://github.com/HighlanderRobotics/lovat-collection/blob/012e62021f9f65a6fff50fffb284a9c5791e78df/lib/storage/scoutReportMigrations.ts) repair historical event-pair problems; Vantage needs explicit version handling without inventing observations.

## Lovat presentation code walkthrough

Reviewed the public dashboard client at commit [79f80d2](https://github.com/HighlanderRobotics/scouting_dashboard_app/tree/79f80d2fb968ee8074714e00757bcc9c60f34a84). Scope: metric definitions, category cards, metric/breakdown details, pick-list creation/models/API requests and selected autonomous-path model/rendering sections. Backend aggregation and scoring formulas are not included in the client files inspected.

[Metric definitions](https://github.com/HighlanderRobotics/scouting_dashboard_app/blob/79f80d2fb968ee8074714e00757bcc9c60f34a84/lib/metrics.dart) centralize labels, units, formatting and visibility. [Metric details](https://github.com/HighlanderRobotics/scouting_dashboard_app/blob/79f80d2fb968ee8074714e00757bcc9c60f34a84/lib/pages/team_lookup/team_lookup_details.dart) expose team/all-team values, differences and supporting match points. Missing values are omitted from plots, and cached responses carry freshness/error states. Vantage must additionally expose definitions, source, sample counts, active filters and disagreement handling through one calculation model.

[Pick-list models](https://github.com/HighlanderRobotics/scouting_dashboard_app/blob/79f80d2fb968ee8074714e00757bcc9c60f34a84/lib/pages/picklist/picklist_models.dart) retain adjustable metric weights and personal configurations. [Analysis requests](https://github.com/HighlanderRobotics/scouting_dashboard_app/blob/79f80d2fb968ee8074714e00757bcc9c60f34a84/lib/reusable/lovat_api/picklists/get_picklist_analysis.dart) send weights, flags and tournament filters and receive contribution data. These clients do not prove how the server combines duplicate scouting reports. Vantage's own tested per-robot/per-match aggregation remains authoritative.

[Autonomous paths](https://github.com/HighlanderRobotics/scouting_dashboard_app/blob/79f80d2fb968ee8074714e00757bcc9c60f34a84/lib/reusable/team_auto_paths.dart) connect timelines, frequency, scores and supporting matches with animation controls. Position interpolation and visual offsets must be distinguished from directly observed positions; animated footage must not imply measured spatial precision.

## Other primary references

| Specialist | Relevant documented behavior | Vantage comparison |
| --- | --- | --- |
| [QRScout](https://github.com/FRC2713/QRScout) | Configurable collection and QR handoff | Counter/timer collection, payload fidelity, transfer without connectivity |
| [ScoutRadioz Voyager](https://wiki.team102.org/scoutradioz/voyager/howto_scouting) | Device-local forms, assigned matches, QR lead transfer and explicit sync state | Assignment distribution, backup coverage, deferred reports, lead reconciliation |
| [Statbotics](https://github.com/avgupta456/statbotics) and [API documentation](https://statbotics.readthedocs.io/en/latest/) | EPA in point units and multiple data access methods | Distinguish reference estimates from team observations; explain units, sources and uncertainty |
| [Trello](https://support.atlassian.com/trello/docs/creating-and-managing-task-dependencies/) | Linked task dependencies | Canonical ownership, due dates, dependency/blocker behavior and history |
| [CheesyParts](https://www.team254.com/documents/cheesyparts/) | Part identifiers, CAD versions and manufacturing tracking | Design quantity to purchasing, receiving, stock and repair consumption |
| [Sortly](https://www.sortly.com/solutions/selling/) | Barcode check-in/out and low-stock alerts | Location, checkout accountability, reorder state and stock consistency |
| [Nexus](https://frc.nexus/) | Event schedules, queuing and notifications | Selected-event consistency, personal next actions and readiness |
| [Notion](https://www.notion.com/help/search) | Search and [sharing permissions](https://www.notion.com/en-gb/help/sharing-and-permissions) | Find decisions/playbook records with consistent permission enforcement |
| [HubSpot tasks](https://knowledge.hubspot.com/tasks/create-tasks) | Follow-up tasks associated with records | Sponsor owners, next actions, deadlines and linked tasks/finance |

Provider descriptions are feature references, not proof that a hosted journey worked in this review. Paid accounts, production messages or competitor data changes are not required to document their public behavior.

## Measurement protocol and acceptance

Use the same recorded match scenarios, devices and network conditions. Include novice scouts and experienced leads; record season, tool revision, configuration, accessibility settings and sample size. Measure repeated trials after a short equal training period. Do not compare different forms as if they were equivalent.

| Journey | Recorded evidence | Status |
| --- | --- | --- |
| Collect auto/teleop/endgame; correct a mistaken action | Completion time, taps, correction accuracy, duration fidelity | Pending |
| Interrupt collection, reload offline, resume and submit twice | Lost observations, duplicates, recovered timer state, explicit device/upload states | Pending |
| Move reports by QR with no network | Time per report/batch, payload completeness, provenance, duplicate/conflict handling | Pending |
| Lead assigns scouts/backups and repairs missing coverage | Time, navigation actions, unresolved cells, identity/privacy checks | Pending |
| Explain an average and compare three robots | Source/units/definition visibility, match/sample fidelity, missing-versus-zero behavior, consistent chart scales | Pending |
| Recalculate pick list with new data during selection | Contribution explanations, saved weights/tiers, revision checks, stable selection board | Pending |
| Task; purchase-to-repair; sponsor-to-finance | Time, navigation effort, linked-record correctness, transaction and authorization results | Pending |

Any result claiming improvement must include raw measurements, failures and limitations. Vantage's existing unit/database evidence is recorded separately in [the completion matrix](completion-matrix.md); these benchmark journeys remain required.
