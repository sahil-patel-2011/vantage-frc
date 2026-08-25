# Subteam coverage audit

**What this is.** A subteam-by-subteam walk of what a member actually needs across an FRC season,
which Vantage surface serves each need today, and what is genuinely missing. Every route named
below was verified to exist as an `apps/web/app/<route>/page.tsx`. Every gap below was verified
against the migration that defines the table, not inferred from the UI.

**What this is not.** A wishlist. If a need is already served, it says so and moves on. The ranked
shortlist at the end is short on purpose.

---

## 0. The subteam model the app already has

Three separate models are in play, and they do not fully agree. That disagreement is itself a
finding, so it is worth naming up front.

| Model | Where | Values |
| --- | --- | --- |
| Season roles | `apps/web/lib/roles/types.ts` (`team_roles.subteam` CHECK) | mechanical, electrical, programming, cad, controls, business, drive_team, scouting, media, safety, other |
| Onboarding tracks | `apps/web/lib/role-onboarding/tracks.ts` | welcome, mechanical, electrical, programming, cad, drive_team, scouting, business, safety + role/focus tracks |
| Actual team subteams | `team_subteams.name` — free text per org | whatever the team typed |

The bridge between the free-text names and the tracks is `matchSubteamTracks()` in
`apps/web/lib/role-onboarding/assign.ts`, a substring keyword match. Two consequences fall
directly out of that table:

- **There is no `media` track.** `"media"` is a keyword on the **business** track, so a media
  student is onboarded into sponsors, grants, and awards. (`/my-kit` works around this with its own
  media keyword check before deferring to `matchSubteamTracks` — see `lib/my-kit/compose.ts`.)
- **There is no `controls` track**, even though `controls` is a valid `team_roles.subteam`.
  `"controls hardware"` routes to electrical and `"controls software"` to programming, which is a
  reasonable split, but a team with a single Controls subteam gets whichever keyword hits first.
- **Pit crew is not its own track.** `"pit"` is a mechanical keyword, so pit crew inherits the
  fabrication path.

---

## 1. Mechanical

**Needs across a season:** know which mechanism is being built and why, find parts, cut/print them,
track weight, log what broke, prep the robot for inspection, and know shop safety rules.

| Need | Surface |
| --- | --- |
| What are we building, and what is the priority | `/robot`, `/subsystems`, `/decisions` |
| Task list and burndown | `/tasks`, `/build`, `/build-burndown` |
| Prototype results before committing | `/prototype-tracker`, `/reuse-advisor` |
| Parts on hand, where they live | `/inventory`, `/bin-shelf-locator`, `/spares` |
| Ordering and lead times | `/orders`, `/vendors`, `/vendor-lead-times`, `/bom-cost-rollup` |
| Making the part | `/manufacturing`, `/print-farm` |
| Weight budget and legal weigh-in | `/weight-budget`, `/robot-weigh-in` |
| What broke and why | `/fmea`, `/failure-patterns`, `/troubleshoot` |
| Inspection readiness | `/inspection`, `/inspection-copilot` |
| Tools and machines | `/tool-checkout`, `/equipment-maintenance` |
| Shop safety qualification | `/safety-training`, `/training` |

**Gap.** `build_tasks.assignee` and `build_task_assignees.assignee` are free text, not a
`users` foreign key. A mechanical student cannot reliably ask "what is assigned to me" — the answer
depends on whether the person who created the task typed their name the same way. `/my-kit` matches
case-insensitively on display name as a stopgap and says so.

---

## 2. Electrical

**Needs:** wire the robot correctly, keep power within budget, keep batteries healthy, pass the
electrical portion of inspection, and diagnose brownouts and CAN faults at competition.

| Need | Surface |
| --- | --- |
| Wiring plan and diagram | `/wiring` |
| Diagnose a wiring/power fault | `/wiring-diagnoser` |
| CAN devices and driver-station bindings | `/control-map` |
| Current draw budget | `/power-budget` |
| Battery inventory, charge state, health | `/batteries`, `/battery-rotation`, `/battery-health-forecast` |
| Electrical inspection items | `/inspection`, `/inspection-copilot` |
| Battery and first-power safety rules | `/safety-training`, `/team/knowledge` |

**Gap.** None specific to electrical beyond the shared assignment gap. This subteam is genuinely
well covered; the electrical onboarding track in `tracks.ts` already points at the right four
surfaces.

---

## 3. Programming

**Needs:** find the repo, keep vendordeps aligned, get code onto the robot, know what changed,
tune constants, build autos, and know when something regressed.

| Need | Surface |
| --- | --- |
| Repo, branch, and AI code context | `/code`, GitHub link on `/team` |
| Automated review of robot code | `/bugbot` |
| WPILib / vendordep alignment | `/software-versions` |
| Deploy history | `/code-deploy-log` |
| Performance regressions between matches | `/code-perf` |
| Constant tuning | `/tuning`, `/tuning-autopilot` |
| Autonomous routines and paths | `/auto-routines`, `/auton-path-library` |
| Button/subsystem contract with drivers | `/control-map` |
| Bring-up checklist | `/bringup` |

**Gap.** `code_bugbot_findings` (migration `0468`) has no owner column, so "which findings are mine
to fix" cannot be answered. Findings can only be dismissed, not assigned. This is a real gap but a
narrow one — most teams triage findings verbally.

---

## 4. CAD

**Needs:** model parts against agreed priorities, get designs reviewed, version and archive them,
see what changed since last review, and hand off to manufacturing.

| Need | Surface |
| --- | --- |
| Connect Onshape/Fusion and drive the agent | `/cad`, `/cad/setup`, `/cad/connections`, `/cad/pair` |
| Design review queue and signoffs | `/cad-review-queue` |
| Versioned document archive | `/cad-vault` |
| What changed since the last look | `/cad-change-radar` |
| Napkin sketch to design brief | `/sketch-to-brief` |
| Decisions already settled | `/decisions`, `/decision-search` |
| Handoff to fabrication | `/manufacturing`, `/print-farm` |

**Gap.** `cad_review_queue_items` records `submitted_by` but has no reviewer assignee — the queue
knows who asked for a review, not who owes one. A CAD lead cannot see "reviews waiting on me", and
neither can `/my-kit`. Signoffs are recorded after the fact in `cad_review_queue_signoffs`.

---

## 5. Scouting

**Needs:** know which matches to scout, capture data fast and consistently, know whether the data
is any good, and hand it to strategy.

| Need | Surface |
| --- | --- |
| Hub, forms, schemas | `/scouting`, `/scouting/forms`, `/scout-schema-negotiate` |
| Who scouts which match | `/scouting/lineup`, `/shift-balancer` |
| Live coverage nudges | `/scout-coverage-live`, `/scouting-heat-signals` |
| Fast capture aids | `/scout-assisted-count`, `/scout-training-mode` |
| Offline / peer sync | `/scout-p2p-relay` |
| Data quality and disagreements | `/scout-crossval`, `/scout-disagreements`, `/data-quality-scorecard` |
| Was I accurate | `/scout-accuracy` |
| Pit scouting | `/pit` |
| Video re-scout | `/video`, `/match-video-index` |

**Best-served subteam in the product.** `scout_assignments` has a real `user_id`, which is why
`/my-kit` can show a scout their own matches without name matching.

**Gap.** `/scout-accuracy` is a leaderboard for the scouting lead. Until `/my-kit`, an individual
scout had no personal view of their own accuracy; that is now composed from the newest
`scout_accuracy_snapshots.scores` entry keyed to their user id.

---

## 6. Strategy / drive team

**Needs:** know the game, know opponents, plan matches, practice, and execute on the field.

| Need | Surface |
| --- | --- |
| Game rules and scoring priorities | `/kickoff`, `/rule-impact` |
| Team intel and rankings | `/intel`, `/dossier`, `/rankings`, `/ranking-projection`, `/district-advancement` |
| Match planning | `/strategy`, `/strategy/board`, `/match-strategy-cards`, `/match-copilot`, `/whiteboard` |
| Opponent and defense prep | `/opponent-watchlist`, `/defense-planner`, `/intel` |
| Alliance selection | `/pick-clock`, `/picklist-collab`, `/picklist-justifier`, `/alliance-selection-desk`, `/strategy/draft`, `/alliance-partner-brief`, `/alliance-sim` |
| Practice | `/practice`, `/driver-tryouts`, `/drive-team-signals` |
| Match day execution | `/command`, `/my-day`, `/match-checklist`, `/schedule` |
| Post-match | `/match-debrief`, `/match-notes-timeline`, `/retro` |

**Gap.** None material. This is the deepest area of the product.

---

## 7. Media

**Needs:** plan content, hit deadlines, keep brand assets in one place, and know who can be
photographed.

| Need | Surface |
| --- | --- |
| Content calendar with owners and due dates | `/media` (`media_content_items.assigned_to` is a real user FK) |
| Brand assets, logos, one-pagers | `/media-kit`, `/team/background` |
| Public-facing deck | `/showcase`, `/showcase/present` |
| Sponsor-facing assets | `/sponsor-suite`, `/sponsor-wall` |
| Match video | `/video`, `/match-video-index` |

**Gaps.**

1. **No media track in onboarding.** A media student is auto-assigned the business track (see §0).
2. **Media consent is not joined to media items.** `consent_records` (`/consent`) stores
   `person_name` as free text with a status, and nothing links a content item to the students in it.
   A media member cannot check "is everyone in this photo cleared" from `/media`.

---

## 8. Business / awards

**Needs:** raise money, track it, write awards, and prove impact.

| Need | Surface |
| --- | --- |
| Business home | `/business` |
| Sponsors: prospects, tiers, renewals, ROI | `/team/sponsors`, `/sponsor-suite`, `/sponsor-tier-calculator`, `/sponsor-renewal-roi`, `/sponsorship` |
| Corporate matching | `/matching-gift-finder` |
| Grants: find, match, write, report | `/team/grants`, `/team/grants/calendar`, `/grant-eligibility-matcher`, `/grant-report` |
| Fundraisers | `/fundraisers` |
| Budget and books | `/team/finance`, `/team/budgets`, `/costs`, `/counter-book`, `/budget-reconciler` |
| Purchase requests | `/orders` |
| Award submissions and drafting | `/award-tracker`, `/writer`, `/impact-essay` |
| Judging practice | `/judge-sim`, `/mock-judging` |
| Impact evidence | `/impact`, `/outreach-calendar` |
| Exports for judges | `/exports` |

**Gap.** None material. Reimbursements are the one open item and migration `0482` is landing in a
parallel wave; `/my-kit` reads `reimbursement_requests` behind a `to_regclass` guard so it lights up
when that lands and stays honestly empty until then.

---

## 9. Safety

**Needs:** run the shop safely, qualify people on machines, log incidents without blame, and carry
safety culture into the pit.

| Need | Surface |
| --- | --- |
| Safety training modules and completions | `/safety-training` (`safety_training_modules`, `safety_training_completions`) |
| Machine qualification matrix | `/training` (`training_skills`, `training_records`) |
| Certifications | `safety_certifications` (surfaced via `/safety-training`) |
| Incident log | `/safety`, `/incidents`, `/incident-heatmap` |
| Consent and medical forms | `/consent` |
| Competition safety | `/inspection`, `/pit`, `/batteries` |

**Gaps.**

1. **Three overlapping qualification stores.** `safety_certifications.person_name` (text),
   `training_records.user_id` (real FK), and `safety_training_completions` all answer "is this
   person cleared for the mill", in different shapes. `/my-kit` reads `skills_graph_entries` and
   `safety_certifications`, and cannot merge in `training_records` without picking a winner.
2. `safety_certifications.person_name` being free text means a member's own certifications are
   name-matched, not id-matched.

---

## 10. Pit crew

**Needs:** know the pit layout, pack everything, fix the robot fast, and know who is on shift.

| Need | Surface |
| --- | --- |
| Pit layout plan | `/pit-map-planner` |
| Packing lists and requests | `/packing` |
| Spares on hand and forecast | `/spares`, `/spare-forecast`, `/spare-robot-kit` |
| Triage a broken robot | `/pit-repair-triage`, `/troubleshoot`, `/failure-patterns` |
| Repeatable procedures | `/checklist-library`, `/match-checklist` |
| Field reset drills | `/field-reset-timer` |
| Pit scouting other teams | `/pit` |
| Shift roster | `/duties`, `/event-day-plan` |

**Gap.** `event_shifts.person_name` is free text with no `user_id`, so the competition shift roster
is not addressable per account. `duty_assignments` **does** have `assigned_user_id`, which is why
`/my-kit` reads duties and not shifts. Two tables answering "who is on at 10am" with different
identity models is the underlying problem.

---

## 11. Leadership / mentors

**Needs:** see whether the season is on track, know who owns what, spot risk early, and hand off.

| Need | Surface |
| --- | --- |
| Season plan and roadmap | `/roadmap`, `/season-planning-workspace`, `/goals`, `/goals-tracker` |
| Role ownership | `/roles`, `/leadership` |
| Risk | `/risks`, `/risk-burndown`, `/cross-domain-alerts` |
| Single-point-of-failure people | `/bus-factor` |
| Team health | `/team-health-dashboard`, `/readiness-score`, `/event-readiness` |
| Attendance and hours | `/attendance`, `/presence`, `/hours`, `/hours/kiosk`, `/mentor-hours` |
| Onboarding new members | `/start`, `/onboarding-buddy`, `/team/getting-started` |
| Recognition | `/recognition` |
| Continuity | `/exit-interview`, `/season-rollover`, `/alumni-network`, `/team/alumni` |
| Knowledge capture | `/team/knowledge`, `/knowledge-gap`, `/knowledge-drafts`, `/notebook` |
| Money and AI spend control | `/team/budgets`, `/team/usage`, `/team/ai-policy` |

**Gap.** `team_roles.holder_name` is free text with no user FK, while the newer `leadership_roles`
table has both `holder_user_id` and `successor_user_id`. So `/leadership` can answer "what is my
role and who succeeds me" and `/roles` cannot. `/my-kit` therefore cannot show a member their own
season role, which is a visible hole in an otherwise complete personal view.

---

## 12. Parents / guardians

**Needs:** know when to drop off and pick up, know travel plans, volunteer, and see how their
student is doing.

| Need | Surface |
| --- | --- |
| Read-only student view, no account required | `/parent-view/[token]` (`parent_contacts.view_token`) |
| Digest email + one-click unsubscribe | `/parents`, `/unsubscribe` (`parent_contacts.unsubscribe_token`) |
| Travel, hotels, on-duty adult | `/logistics` |
| Announcements | `/notifications` |
| Guest pit / stands access | `/visit-invites` |
| Volunteer hours, when they have an account | `/mentor-hours` (`mentor_hours_entries.role = 'parent_volunteer'`) |

**Gaps.**

1. **No parent volunteer signup.** `duty_assignments.assigned_user_id` references `users`, and the
   `kind` CHECK is `('scouting','pit','drive_team','outreach')` — there is no chaperone, driver,
   concessions, or travel duty, and most parents have no account to be assigned to. Parent
   volunteering exists only as an after-the-fact hours log.
2. The parent view is token-scoped and read-only by design, so anything requiring a parent to *act*
   (claim a shift, confirm a trip form) has nowhere to live.

---

## 13. The individual person — the cross-cutting gap

Every section above lists surfaces organized by **topic**. Until this wave there was no surface
organized by **person**, other than `/my-day` (competition day only, keyed on the active event) and
`/hours-self-view` (hours only).

`/my-kit` (`apps/web/app/my-kit/`, `apps/web/lib/my-kit/`) fills that: subteam and role, open tasks,
upcoming subteam calendar items and duties, scouting assignments plus personal accuracy, hours total
and day streak, learning ledger, skills and certifications, checked-out tools, purchase requests and
reimbursements, and onboarding progress — all read-only, all `to_regclass`-guarded, every row linking
back to the surface that owns the record. It owns no tables and needed no migration.

---

## Ranked shortlist of real remaining gaps

Ranked by how many people the fix reaches, times how badly the absence is felt.

1. **Free-text identity in assignment columns.** `build_tasks.assignee`,
   `build_task_assignees.assignee`, `team_roles.holder_name`, `safety_certifications.person_name`,
   `tool_checkout_loans.borrower_name`, `event_shifts.person_name`, and `consent_records.person_name`
   are all text where a nullable `user_id` alongside the text would do. Adding a nullable FK
   (keeping the text for people without accounts, exactly as `leadership_roles` and
   `mentor_hours_entries` already do) makes every "what is mine" question answerable and removes the
   name-matching stopgap in `/my-kit`. **Highest leverage item in this audit.**

2. **Parent volunteering has no action surface.** Widen `duty_assignments.kind` and give it a
   nullable `parent_contact_id` so a chaperone or driver shift can be assigned to a guardian, and
   expose claim/confirm inside the existing token-scoped `/parent-view/[token]`.

3. **Two competing shift models.** `event_shifts` (free-text names, minute offsets, season-scoped)
   and `duty_assignments` (real user FK, timestamps, calendar-linked) both answer "who is on".
   Pick one — `duty_assignments` has the better identity model — and make `/event-day-plan` and
   `/duties` read the same rows.

4. **Three qualification stores.** `safety_certifications`, `training_records`, and
   `safety_training_completions` overlap. A single "is this person cleared for X" read model would
   let `/my-kit`, `/tool-checkout`, and `/inspection` all gate on the same answer.

5. **Media consent is not connected to media content.** Link `media_content_items` to the students
   depicted and read `consent_records` for their status, so `/media` can warn before a post.

6. **No media or controls onboarding track.** Two entries in `tracks.ts` plus keyword rows in
   `SUBTEAM_KEYWORD_MAP`. Small, cheap, and it fixes media students being onboarded as fundraisers.

7. **CAD reviews have no reviewer.** Add a nullable assignee to `cad_review_queue_items` so
   "reviews waiting on me" is answerable.

8. **Bugbot findings have no owner.** Same shape as #7, narrower audience.
