# Production completion matrix

Generated inventory: {"pages":324,"apis":499,"manifests":123,"coreWorkflows":20,"historicalTables":615,"scheduledJobs":4,"cronRoutes":11,"durableWorkflows":3,"connectorRoots":7}. Historical table names are not proof of the current database schema.

An unchecked item is unverified, not a passing feature. Record test names and deployed evidence before marking it complete. A partial test is evidence for that dimension only, not acceptance of the entire workflow.

| Feature | Real data | Permissions | Actions | Failures | Mobile | Offline | Backup | Evidence |
|---|---|---|---|---|---|---|---|---|
| home-saved-boards | Partial: real saved-board APIs and local owner/new-team Home journeys | Partial: actual member access and scout admin denial | Partial: saved My Home and automatic setup-to-Home | Partial: unready Home gate repaired and retested | Partial: final built Home and island at390x844 | Pending | Partial: checkpoint | DashboardHomeView; evidence/journey-marketing-signin.json; journey-team-invitations.json; ui-navigation-refresh.json; production and useful default coverage pending |
| event-day | Pending | Pending | Partial: island/menu and section keyboard navigation | Open: No event linked while Home/calendar/Teams show event | Partial: phone navigation; full workflow pending | Pending | Pending | ui-navigation-refresh.json; selected-event coherence and full workflow acceptance pending |
| scouting-collection | Partial: actual synthetic reports with timestamped actions/recorded zero | Partial: personal/team storage and acknowledgment tests | Partial: actual review/history/CSV and immediate first-tap rerun | Partial: original first-tap and offline QR failures retained; tap fixed, QR retest pending | Pending | Partial: actual outage save/cached-shell reload; multipart unit proof | Partial: checkpoint includes history | journey-scouting-workflows.json; journey-scouting-synchronous-scroll-retest.json; journey-scouting-production-build-offline.json; qr-transfer.test.ts; full season/positions/paths/transfer/camera pending |
| scouting-analysis | Partial: shared duplicate-match totals/formulas; actual12point profile/reconciliation agreement | Partial: person/event comparison state | Partial: three-team comparison, profiles, corrections, real CSV | Partial: missing/formula/phase sample tests; comparison-bar acceptance open | Partial: actual24team roster at390x844 | Partial: cached profiles and personal/event state | Partial: checkpoint | scouting-rating.test.ts; scouted-ratings.test.ts; scouting-points-display.test.ts; ui-navigation-refresh.json; actual synthetic scouting journeys; complete metrics/filters/pick-list/strategy pending |
| scouting-partner-sharing | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| canonical-work | Partial: actual synthetic canonical todos API | Partial: actual admin task actions | Partial: assignment/status/due/deep-link/Home reload journeys | Partial: stale work count fixed/rerun | Pending | Pending | Partial: checkpoint | journey-team-workflows-rerun.json; dependencies/history/chat/source consolidation pending |
| chat-playbook | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| purchasing-stock-repairs | Partial: actual3unit purchase/stock/value and repair consumption | Partial: actual admin actions; cross-role proof pending | Partial: request/approval/order/receive/stock/repair/tools journeys | Partial: fractional quantity refusal and one ledger entry after reload | Pending | Pending | Partial: checkpoint | journey-build-business-workflows.json; journey-build-business-rerun.json; journey-purchase-quantity.json; design/BOM/payment linkage pending |
| pit-batteries | Partial: actual synthetic charge/resistance/readiness records | Partial: actual admin log actions | Partial: shared Competition/cart/Pit cooldown and fresh-test rerun | Partial: original false-ready repaired; stale/aging/missing unit checks | Pending | Pending | Partial: checkpoint | journey-build-business-rerun.json; pit-operations.test.ts; release/responsibility/cross-role/offline proof pending |
| cad-code | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| learning | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| finance-ledger | Partial: actual ledger with explicit inclusion flags | Partial: actual sponsor cross-team PG denial; full roles pending | Partial: cash/expense/refund/reimbursement/stock journeys | Partial: numeric SQL error and stale balance repaired; exact duplicate prevention | Pending | Pending | Partial: checkpoint and real Google included totals | journey-build-business-rerun.json; journey-purchase-quantity.json; sponsor-contribution-integration.test.ts; google-summary.json; grant awards/cash and commitments/spending semantics unresolved |
| sponsors-grants | Partial: actual synthetic owners/follow-up/grant statuses | Partial: admin/browser and sponsor PG denial | Partial: sponsor cash and grant application status journeys | Partial: sponsor cash SQL fix/rerun; award credited as cash remains defect | Pending | Pending | Partial: checkpoint | journey-build-business-rerun.json; source-linked tasks/evidence, grant award-versus-received and actual deadlines pending |
| people-logistics | Partial: actual roles/mentor hours/calendar/travel/packing | Partial: exact invited scout/admin and preserved memberships | Partial: calendar/RSVP, mentor hours, trip/travel/checklist/packing journeys | Partial: mentor classification and async form reset fixed/rerun | Partial: final Team-to-Logistics navigation, existing trip/checklist and guidance at390x844 | Pending | Partial: checkpoint | journey-new-team-invitees.json; journey-mentor-second-team.json; journey-team-workflows-rerun.json; ui-navigation-refresh.json; full roles/mobile actions/offline/production pending |
| account-administration | Partial: real synthetic signup/invite profiles and membership | Partial: wrong-email refusal, exact scout/admin access and person-scoped cache/outbox | Partial: owner invites and actual scout/mentor joins | Partial: age confirmation and owner-to-scout cache disclosure fixed/retested | Pending | Partial: personal generic outbox checks; scouting/shell review open | Partial: checkpoint | evidence/journey-signup.json; journey-new-team-invitees.json; offline/outbox.test.ts; export/deletion/security/production still pending |
| team-provisioning | Partial: five real Google books, persisted resources and verified defaults | Partial: actual restricted worker and owner/admin readiness boundary | Partial: real claim/retry/provisioning/automatic Home and invitations | Partial: refresh/retry, interrupted Workflow failure visibility, strict reads and preserved resources | Partial: real progress UI; phone acceptance pending | Partial: durable callbacks; restart/load journey pending | Partial: actual initial Google checkpoint and journal gate | evidence/journey-team-invitations.json; journey-new-team-invitees.json; journey-readable-google-sync.json; setup418460ms misses target; 50-team/production acceptance pending |
| google-recovery | Partial: 719-table encrypted Google checkpoint | Partial: operator-only recovery and request RLS checks | Partial: isolated download/restore | Partial: shard integrity checks and durable quota deferral without failed-event acknowledgment | Pending: operational status UI | Pending | Partial: row counts restored; replay/sequence/retention pending | evidence/recovery-proof.json; db/recovery-integration.test.ts; recovery/journal.test.ts; long-text.test.ts; not full recovery acceptance |
| personal-codex | Partial: installed App Server handshake | Partial: actual cross-person/member/revocation and kill-switch checks | Partial: real MCP subprocess with test backend | Partial: unauthenticated/revoked/identity override rejection | Pending | Pending: real device disconnect | Partial: checkpoint; restore credential revocation pending | connector/test/mcp-stdio.test.ts; db/personal-bridge-integration.test.ts; ai-bridge/feature-tools-integration.test.ts; authenticated execution/approvals pending |
| age-policy-deletion | Partial: shared policy source and consent records | Partial: age/collection consent enforcement | Partial: collection-time training flag and withdrawal proof | Partial: raw training access rejection | Pending | Pending | Partial: checkpoint; deletion/retention pending | core/src/eligibility.test.ts; db/src/training-choice-integration.test.ts; legal/documents.test.ts; entry-point/deletion/update journeys pending |
| media-removal | Partial: stored records retained | Partial: shared UI/API gates | Partial: PDF document receipt path | Partial: photo MIME rejection tests | Pending | Partial: scouting media queue gates | Partial: checkpoint | media-availability.test.ts; finance/reimbursements.test.ts; storage-node/archive.test.ts; db/receipt-retirement-integration.test.ts; browser/API/external-video journeys pending |
| alliance-partner-brief | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| alliance-selection-desk | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| alliance-sim | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| alumni-network | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| auton-path-library | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| award-tracker | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| battery-health-forecast | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| battery-rotation | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| bin-shelf-locator | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| bom-cost-rollup | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| budget-reconciler | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| build-burndown | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| bus-factor | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| cad-change-radar | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| cad-review-queue | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| cad-vault | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| checklist-library | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| claim | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| code-deploy-log | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| code-perf | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| counter-book | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| cross-domain-alerts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| cross-team-scrim | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| data-quality-scorecard | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| decision-critic | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| decision-search | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| defense-planner | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| degraded-mode | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| district-advancement | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| drive-team-signals | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| driver-tryouts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| epa-trend-alerts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| equipment-maintenance | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| event-day-plan | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| event-readiness | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| exit-interview | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| failure-patterns | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| field-reset-timer | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| goals-tracker | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| grant-eligibility-matcher | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| grant-report | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| hours-self-view | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| impact-essay | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| incident-heatmap | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| inspection-copilot | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| judge-sim | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| knowledge-drafts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| knowledge-gap | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| leadership | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| manufacturing | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| match-checklist | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| match-copilot | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| match-delta-watcher | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| match-notes-timeline | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| match-sim | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| match-strategy-cards | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| match-video-index | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| matching-gift-finder | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| media-kit | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| media | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| meeting-autopilot | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| mentor-hours | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| migrate | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| mock-judging | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| object-chat-bridge | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| offline-shell | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| onboarding-buddy | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| opponent-watchlist | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| outreach-calendar | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| overnight-intel | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| pairwise | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| parent-comms | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| parts-relay | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| picklist-collab | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| picklist-justifier | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| pit-map-planner | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| pit-repair-triage | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| presence | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| print-farm | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| prototype-tracker | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| ranking-projection | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| readiness-score | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| retro | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| reuse-advisor | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| risk-burndown | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| robot-weigh-in | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| rule-impact | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| safety-training | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-accuracy | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-assisted-count | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-coverage-live | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-crossval | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-data-impact | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-disagreements | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-field-budget | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-p2p-relay | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-schema-negotiate | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-training-mode | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scout-voice | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| scouting-heat-signals | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| season-finance | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| season-planning-workspace | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| season-report | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| season-rollover | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| shift-balancer | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| sketch-to-brief | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| skills-graph | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| spare-forecast | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| spare-robot-kit | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| sponsor-renewal-roi | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| sponsor-suite | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| sponsor-tier-calculator | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| sponsor-wall | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| standup-digest | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| subsystem-signoff | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| team-health-dashboard | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| team-tags | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| tool-checkout | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| training | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| tuning-autopilot | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| vendor-lead-times | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| wiring-diagnoser | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
