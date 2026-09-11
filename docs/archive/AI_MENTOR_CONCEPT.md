# The AI Mentor concept — Call Your Shot

Product ideation for Vantage's founding idea: AI-agent-first FRC where the agent does real work
AND teaches — CAD, shop tools, and engineering principles. 33 ideas were generated across five
lenses against a researched pedagogy brief (intelligent tutoring systems, cognitive apprenticeship,
worked-example fading, retrieval practice, CAD-education research), then judged for mission fit,
novelty, feasibility on current code, and whether a 14-year-old would come back voluntarily.

## Flagship: Call Your Shot

Vantage never hands a student an answer they haven't called: every calculator result, every agent operation, and eventually every design change is locked behind a committed, falsifiable prediction — and the robot itself grades it, because the math, the CAD kernel, and the match are the answer key. The AI then teaches from the gap between what you predicted and what actually happened, on your robot, with your numbers.

**MVP (one engineer, current code):** One engineer, existing code, two steps. Week 1-2: a learning-mode client wrapper on /gearbox (then /power-budget and the shooter table) — student-role users see their real stage chain but the computed reduction/RPM/torque fields render as prediction inputs; submit locks the guess, the existing pure functions in apps/web/lib/gearbox.ts (compoundReduction, outputRpm, torqueMultiplier) compute the truth, and the reveal shows predicted-vs-actual with a deterministic delta explanation (optional metered AI coach, feature=gearbox-coach, explains the specific mis-weighted term). Mentors are never gated; gearboxes without motorFreeRpm show the honest empty state. Per-concept prediction-error rows land in one new org-scoped RLS table (next-numbered migration per the 0024 pattern) feeding apps/web/lib/skills-graph/compute-skills-graph.ts. Week 3-4: the predict-before-run card in apps/web/app/cad/cad-operation-composer.tsx — every staged onshape_sketch_rectangle/onshape_extrude renders 2-4 concrete outcome choices plus a free-text why before execution; the viewport shows the truth; a 'just run it' escape exists but is logged as help-taken. Zero new CAD tools, zero new AI surfaces required.

**Full vision:** The prediction gate becomes the product's universal grammar. Phase 2 adds the one tool the whole CAD-teaching family needs — onshape_set_parameter, built beside onshape_extrude with the onshape-features.ts payload builders and checkpoint/rollback via cad_checkpoints (0016) — and the Tug Test arrives: the agent picks a driving dimension in the student's live bound model ('bumper rule change: widen the frame 1 inch'), the student predicts which features survive, the agent tugs, the kernel adjudicates, and the student must explain and repair the wreckage themselves before the revert. Contrast rebuilds (Two Trees, One Part) extend it: the agent models the same geometry a second way in a scratch studio, tugs both, and the student articulates why one tree survived. Because the CAD kernel and the calculators' math produce the feedback, nothing is fabricated — the no-fake-data rule extends into pedagogy itself. Per-concept calibration accumulates in the skills graph, so gates fade on demonstrated calibration (expertise reversal handled by design: the gate exists only while the mastery estimate is low), and that same calibration data is what later powers the Forgetting Agent's autonomy ratchet and the mentor dashboards. Prediction accuracy becomes the exam nobody takes: assessed entirely from real work on the team's own robot.

Merged from: #1 The Tug Test (Machinist), #5 Call Your Shot Calculators, #8 The Tug Test (Socratic CAD), #9 Predict-Before-Run Gate, #10 Two Trees, One Part (as the contrast-case extension), #15 Predict-Then-Reveal Gearbox, #17 Design-Intent Tug Test, #20 Shooter Curve Explainer

## Product principles (the rules that make Vantage AI-mentor-first)

- Attempt before answer: no teaching surface reveals a result until the student commits a falsifiable prediction or attempt — and mentors are never gated.
- The robot is the answer key: pedagogical feedback comes from real tools — the CAD kernel, the calculators' math, the team's measured data — never from the model's unverifiable opinion. The no-fabricated-data rule extends to teaching.
- The agent narrates every operation it performs; work done silently is work nobody learned from.
- Assistance fades as the skills graph fills: help level is computed per student per skill, scaffolds retire themselves on demonstrated calibration, and the fading is always legible to the student, never sneaky.
- Doing beats watching six-to-one: the agent demos at most one instance, hands the mouse back, and verifies completion against the live artifact, never self-report.
- Hints climb a ladder — pointing, conceptual, bottom-out — cheapest first, every rung logged to the learning ledger; hints are logged, never priced.
- Deadline mode is allowed but never free: every skipped learning moment is recorded as a mentor-visible debt with a scheduled repayment.
- Students author the artifact: notebook entries, postmortems, and wiki pages are student-written prose the agent critiques against quoted evidence — never agent prose the student signs.
- Mentors stay in the loop: every mastery claim is a draft until a human countersigns, and every dashboard exists to change what a human does at the next practice.
- Assess from real work, not quizzes: mastery evidence comes from predictions, repairs, defenses, and how students direct the agent — and nothing is scored that the student cannot see about themselves.
- Honest empty states extend to pedagogy: no team data, no lesson — never a canned example wearing the team's name.
- The agent may play a role — rookie, examinee, opponent — but never lies about its competence: scripted errors are announced as the premise and disclosed afterward, and its real judgment is never secretly degraded.

## Portfolio

| Tier | Score | Concept | One-liner |
|---|---|---|---|
| build-now | 9 | **Robot Physics Lab** | Every real failure — a brownout, a high-RPN FMEA row, a tipped-robot video timestamp — spawns a gated, step-by-step physics derivation using the team's own measured numbers (merges #16, #18, #19). |
| build-now | 8.5 | **Scrap-Pile Postmortem** | A resolved failure won't file itself: the agent assembles only real evidence, runs the machinist's five whys, and nothing lands in the notebook until the student can write the causal chain in their own words (merges #4, #25). |
| build-now | 8.5 | **Design Defense** | Submitting to the CAD review queue triggers an oral exam: the agent reads the actual feature tree and the author must defend their design intent before a human mentor countersigns release (merges #6, #14). |
| build-now | 8 | **Demo, Then Mirror** | The agent builds exactly one instance while narrating why, then hands the mouse back — 'your turn: the other three pockets' — and verifies completion against the live model, not self-report (#2). |
| build-now | 8 | **The Apprentice Ledger** | One append-only learning ledger under every surface — hints taken, predictions called, delegation quality scored from CAD-session transcripts — feeding the mastery model and a mentor's foreman-view, with no quiz anywhere (merges #7, #30). |
| build-now | 7.5 | **Season Syllabus Compiler** | June's exhaust becomes September's curriculum: logged decisions and graduating seniors' own artifacts compile into commit-before-reveal case cards whose epilogues are what actually happened (merges #21, #22). |
| build-now | 7.5 | **Teach the Team Brain** | The agent publishes what it doesn't know about this robot; students close the gaps by teaching it — surviving a Socratic interrogation checked against real numbers — and are cited by name in every future answer (merges #32, #26). |
| build-now | 7 | **Teach-Back Pairing Engine** | The skills graph stops being a directory: it books expert-novice sessions on real backlog tasks and only proposes a proficiency bump after the learner teaches it back to a passing grade (#23). |
| build-now | 7 | **Tool Checkout Ticket** | Checking out the bandsaw asks you two questions about the bandsaw — spaced by your own history, never blocking, mentor-overridable in one tap, always feeding the skills graph (#3). |
| build-next | 8.5 | **The Forgetting Agent** | The only AI designed to get weaker as you get stronger: agent tool permissions ratchet down per student per skill, and every deadline override becomes a scheduled, mentor-visible learning debt (merges #29, #11, #13). |
| build-next | 7.5 | **Rookie Bot** | Apprentice mode: the agent builds in the student's document while making disclosed, literature-classified novice mistakes — and plays dumb until the student can state the rule it broke (#27). |
| build-next | 7.5 | **The Agent Files for Review** | Nothing the agent builds touches team documents until a student runs the design review on it — an evidenced checklist, a verdict in the decision log, and exactly one agent rebuttal (#33). |
| explore | 7 | **The CAD Dojo** | Ranked Tuesday-night play on scratch copies of the real robot: rescue drills on sabotaged parts and student-vs-agent modeling duels, all graded mechanically by the kernel — mass properties and what survives the tug (merges #12, #28). |

### Concept details

#### Robot Physics Lab  (build-now)

Every real failure — a brownout, a high-RPN FMEA row, a tipped-robot video timestamp — spawns a gated, step-by-step physics derivation using the team's own measured numbers (merges #16, #18, #19).

- **Mechanic:** Failure records trigger stepped worksheets the student must answer before the verdict renders: brownout debriefs join power-budget peak amps with the battery fleet's resistance_test logs to derive V = 12 − I·R against the 6.8V roboRIO threshold on the exact battery that browned out; FMEA rows withhold all mitigation talk until the student derives the load path from the subsystem's real gearbox reduction and weight-budget mass; 'failure'-tagged video notes freeze at atSeconds and demand a CoG/tipping estimate checked against actual per-subsystem weights. Missing data degrades to qualitative mode with an explicit 'log a resistance test to check this numerically' state — never assumed values.
- **Teaching loop:** Step-granularity feedback (VanLehn's active ingredient) on the student's own artifact, anchored at the emotionally salient moment the physics mattered; repeat-failures recurrence triggers spaced retrieval ('this failed again at Heartland — walk the load path from memory').
- **Builds on:** apps/web/lib/power-budget.ts, battery.ts + battery-reliability.ts (resistance_test), fmea/ (evaluate.ts, repeat-failures.ts), gearbox.ts, weight-budget.ts, video-review.ts (NOTE_TAGS 'failure', atSeconds), match-debrief.ts — all pure-lib joins, no new tools.

#### Scrap-Pile Postmortem  (build-now)

A resolved failure won't file itself: the agent assembles only real evidence, runs the machinist's five whys, and nothing lands in the notebook until the student can write the causal chain in their own words (merges #4, #25).

- **Mechanic:** An incident or resolved pit_repair_triage_reports row spawns a postmortem card assembling the FMEA row that did or didn't predict it, tuning-log entries around that match, video timestamps, and the linked CAD element. The fixer answers the why-chain on screen; the agent critiques each answer against quoted evidence (the Bugbot findings-must-quote-source contract). Only when the chain holds does it file the student's text — never its own — into the notebook and decision log, back-link the FMEA row's detection controls, and enroll the card as a spaced offseason retrieval quiz in /training. No resolved repair, no card.
- **Teaching loop:** Self-explanation (Chi) and cognitive-apprenticeship articulation on the repair they personally made while the context is minutes old, then testing-effect retrieval (~g=0.7) via offseason interleaving — 971's scrap-pile culture compressed into the 48 hours after the part broke.
- **Builds on:** pit_repair_triage_reports (0210), fmea_failures + failure-patterns, tuning.ts, match-video-index, notebook.ts, decisions, knowledge_pages, /training (0250), Bugbot's quoting discipline in packages/agent.

#### Design Defense  (build-now)

Submitting to the CAD review queue triggers an oral exam: the agent reads the actual feature tree and the author must defend their design intent before a human mentor countersigns release (merges #6, #14).

- **Mechanic:** A cad-review-queue submission makes the agent pull the part's real feature list via onshape_describe and generate 3-5 questions grounded in specific features ('Sketch 4 dimensions the hole from the blank's corner — what happens when the plate gets 10mm shorter?'), every question citing the tree. The student answers in a structured defense form; weak answers get graduated probes (pointing → conceptual, never the fix) and open a skills_graph_mentor_requests row instead of an auto-answer. The transcript attaches to the queue item and decision log; a human countersigns before release. The live-tug upgrade for contested claims arrives free once the flagship ships onshape_set_parameter.
- **Teaching loop:** The single highest-value ritual of elite teams — the defended design review — delivered to the thousands of teams with no CAD mentor: articulation at decision points, questions at step granularity on their own tree, and human closure of the loop.
- **Builds on:** cad-review-queue route + 0263, onshape_describe in packages/cad/src/claude-cad.ts, decision_records (0101), skills_graph_mentor_requests (0239), meteredAI. Needs no new CAD tools.

#### Demo, Then Mirror  (build-now)

The agent builds exactly one instance while narrating why, then hands the mouse back — 'your turn: the other three pockets' — and verifies completion against the live model, not self-report (#2).

- **Mechanic:** A demo budget in cad-agent-action.ts caps agent-built features per request. The agent runs onshape_sketch_rectangle + onshape_extrude for one instance with a streamed narration pane ('dimensioning from the bearing bore, not the plate edge, because the bore must not move'), posts a your-turn task card, then switches to watch mode: polling onshape_describe and nudging when the student's attempt is under-constrained or dimensioned off the wrong datum.
- **Teaching loop:** Worked-example fading / gradual release with expert thinking made audible (cognitive apprenticeship modeling), preserving the ~6x doer effect; watch-mode nudges are step-level coaching on the student's own attempt. Inverts the product's headline capability — the copilot that deliberately stops.
- **Builds on:** cad-agent-action.ts allowed-tool gating, claude-cad.ts execution loop, cad-operation-composer.tsx for the task card, autonomous-agent-panel.tsx for narration. Uses only the six existing tools.

#### The Apprentice Ledger  (build-now)

One append-only learning ledger under every surface — hints taken, predictions called, delegation quality scored from CAD-session transcripts — feeding the mastery model and a mentor's foreman-view, with no quiz anywhere (merges #7, #30).

- **Mechanic:** All teaching surfaces route help through one 3-level hint API (point → concept → bottom-out, cheapest first). Every hint, prediction, override, and agent-directive is appended to a learning ledger built on the billing usage-ledger pattern (append-only rows, summed on read, no denormalized counter). Persisted cad-agent-session transcripts are rubric-scored for strategic-CAD indicators (named datums, stated load cases, anticipated edits vs 'make it look like the picture'). compute-skills-graph.ts aggregates into mastery estimates; repeated bottom-out hints on one skill flag unproductive struggle to a mentor. Everything the system scores, the student can see — framed as 'how you talk to the robot'.
- **Teaching loop:** Knowledge tracing from authentic work rather than test items, closing the ASSISTments loop: the data exists to change what a human mentor does at next practice. This is also the substrate the flagship's fading and the Forgetting Agent's ratchet consume.
- **Builds on:** packages/billing ledger pattern, apps/web/lib/cad/cad-agent-session.ts transcripts, compute-skills-graph.ts, /skills-graph mentor views, hooks in packages/agent (chat-system-prompt.ts, orchestrator.ts).

#### Season Syllabus Compiler  (build-now)

June's exhaust becomes September's curriculum: logged decisions and graduating seniors' own artifacts compile into commit-before-reveal case cards whose epilogues are what actually happened (merges #21, #22).

- **Mechanic:** At season rollover, decision_records with complete context/options/rationale become /training case cards: rookies commit a choice and written rationale in a locked form before the reveal of what the team chose and how it turned out — supersedes_id chains supply real 'it didn't work' epilogues no fabricated scenario can match. Exit interviews interrogate seniors against work they authored (their decision records, triage reports, design reviews), drafting artifact-embedded lessons plus completion tasks, each approved by the senior before landing in the wiki. Incomplete records are skipped — honest empty state.
- **Teaching loop:** Prediction-before-reveal on real institutional decisions (ICAP constructive) plus articulation of tacit senior judgment against concrete artifacts; knowledge transfers as practice, not prose, and stops walking out the door every June.
- **Builds on:** decision_records (0101), /training (0250), /season-rollover, /exit-interview + 0438 wiki pipeline, knowledge_pages, meteredAI for card generation.

#### Teach the Team Brain  (build-now)

The agent publishes what it doesn't know about this robot; students close the gaps by teaching it — surviving a Socratic interrogation checked against real numbers — and are cited by name in every future answer (merges #32, #26).

- **Mechanic:** A Gaps board generated from real signals: knowledge-gap scans, decision-log entries missing a why, bus-factor-1 subsystems, undocumented CAD. A student claims a gap and writes the explanation; the agent pushes back until it reaches mechanism, verifying every checkable claim against the gearbox/weight/power math ('you said stiffness; the calc says bending load is trivial — what's the real reason?'). Surviving entries become agent-retrievable knowledge permanently attributed ('per Maya's write-up, Nov 26'). Bus-factor-1 gaps open three-role faded lessons: agent drafts the worked-example half from real data, the lone expert fills in the reasoning blanks, a named novice completes the faded remainder.
- **Teaching loop:** Learning-by-teaching with a non-compliant pupil — self-explanation pushed to causal mechanism (Chi) — with attribution as the Tuesday-night motivation; the artifact doubles as institutional memory against graduation. CAD-claim verification via tug arrives with the flagship's tool.
- **Builds on:** apps/web/lib/knowledge + knowledge-gap (0242), /bus-factor, playbook/wiki, gearbox.ts + weight-budget.ts + power-budget.ts for verification, agent knowledge plumbing, skills-graph credit.

#### Teach-Back Pairing Engine  (build-now)

The skills graph stops being a directory: it books expert-novice sessions on real backlog tasks and only proposes a proficiency bump after the learner teaches it back to a passing grade (#23).

- **Mechanic:** The agent diffs skills_graph_entries proficiency against open mentor requests and certification gaps, proposes evidence-cited pairings, and books calendar sessions attached to real build-backlog tasks, not toy exercises. Afterward the learner must teach back — quizzed on questions generated from the pair's actual task — and only a pass produces a draft proficiency row with an evidence_note citing the teach-back, pending a human certifier's click.
- **Teaching loop:** Mastery-model-driven practice targeting plus the protégé effect and self-explanation; the human-certifier gate keeps adult mentors as the authority on advancement (the ASSISTments teacher loop).
- **Builds on:** skills_graph_entries + skills_graph_mentor_requests (0239), training_skills/training_certifications (0250), /calendar API, /bus-factor for prioritizing one-person skills.

#### Tool Checkout Ticket  (build-now)

Checking out the bandsaw asks you two questions about the bandsaw — spaced by your own history, never blocking, mentor-overridable in one tap, always feeding the skills graph (#3).

- **Mechanic:** An inventory checkout triggers 2-3 retrieval questions generated from that student's own safety-training record for that tool class, spaced per student per machine: yesterday's tool asks nothing, a six-week-idle saw asks more. Wrong answers flag and queue the training module but never block — a mentor overrides on-screen. Every result appends to the skills graph. No safety-training data configured → plain checkout with a setup note. Ship with mentor-configurable scope: quiz records adjacent to safety sign-offs are a liability paper trail some programs will want off.
- **Teaching loop:** Retrieval practice + spacing (testing effect ~g=0.7) fused to the physical moment the knowledge is about to be used — possible only because Vantage already owns both the inventory ledger and the training record.
- **Builds on:** apps/web/lib/inventory.ts checkout flow, safety-training lib + route (0272), compute-skills-graph.ts, equipment-maintenance for tool identity.

#### The Forgetting Agent  (build-next)

The only AI designed to get weaker as you get stronger: agent tool permissions ratchet down per student per skill, and every deadline override becomes a scheduled, mentor-visible learning debt (merges #29, #11, #13).

- **Mechanic:** Tool dispatch in run-cad-agent.ts is gated on the requesting student's per-skill mastery: novice gets narrated full demos; developing gets completion setups ('base sketch is in — you add the pocket and the bore; I'll watch'); mastered gets 'you outgrew this; I can hint' plus the 3-level ladder. A Deadline Override always exists for build-season crunch, but every override logs a debt with the agent's recorded per-feature rationale and auto-schedules a redo task (rebuild in a scratch studio, coached from that rationale, verified by tug); repaid debts credit the skills graph. The ladder position is visible in the adaptive panel — fading is legible, never sneaky.
- **Teaching loop:** Backward-fading enforced at the permission layer rather than by prompt vibes — the expertise-reversal answer — with Bastani-safe hints replacing answers, and override-plus-redo converting deadline work back into spaced retrieval. This is the structural resolution of the compete-vs-teach founding tension, and the identity statement no competitor will copy.
- **Builds on:** run-cad-agent.ts + adaptive-context.ts, cad_user_preferences/cad_team_profiles (0185), cad_jobs/cad_job_steps (0016) for honest agent-did/student-did ratios, calendar tasks, skills graph. Build-next because the ratchet needs mastery-data density (seeded by the flagship and the Apprentice Ledger) and more gateable tools than today's six to bite.

#### Rookie Bot  (build-next)

Apprentice mode: the agent builds in the student's document while making disclosed, literature-classified novice mistakes — and plays dumb until the student can state the rule it broke (#27).

- **Mechanic:** An error script salted with classified novice errors (dimension from a cosmetic face, unconstrained sketch, fragile feature order) is injected into the agent's plan before execution. It pauses at checkpoints — 'look OK so far, boss?' — and when the student flags a mistake it plays dumb ('why does that matter?') until the student articulates the rule, then fixes it on screen. Missed errors are revealed at session end by tugging a driving dimension and letting the model visibly break. Errors are scripted and disclosed post-session: role-play, never deception about the agent's real judgment. Catch/miss outcomes update per-skill mastery.
- **Teaching loop:** Protégé effect plus self-explanation — the student must verbalize the design rule, not just spot the wrong click — with error-detection as step-granularity feedback in reverse and the end tug as validated design-intent assessment.
- **Builds on:** run-cad-agent.ts/cad-agent-session.ts plan injection, skills graph, metered billing path. Build-next: authentic novice errors (wrong datum, missing coincident constraint) need constraint-level sketch tools beyond sketch_rectangle/extrude, and the reveal needs the tug tool.

#### The Agent Files for Review  (build-next)

Nothing the agent builds touches team documents until a student runs the design review on it — an evidenced checklist, a verdict in the decision log, and exactly one agent rebuttal (#33).

- **Mechanic:** All agent-generated CAD (deadline mode, dojo entries, rookie-mode fixes) lands in the review queue addressed to a student reviewer chosen by skill area. The review is a checklist the student must evidence, not click: one-click tugs on two driving dimensions with reported outcomes, mass checked against the weight budget, tree checked against the playbook's design-intent rules. Verdict plus written rationale posts to the decision log; the agent gets one structured rebuttal the student must answer before the verdict is final; merge is mechanically blocked until then.
- **Teaching loop:** The elite-team design review with roles reversed — the student as critic interrogating a worked example under argumentation pressure — which also structurally solves automation bias: unexamined AI output cannot enter the team's real work. Review quality over time is another honest mastery signal.
- **Builds on:** cad-review-queue (0263), apps/web/lib/decisions, weight-budget.ts, playbook/knowledge lib for intent rules, reviewer assignment via compute-skills-graph.ts. Build-next: the checklist's one-click tug depends on onshape_set_parameter.

#### The CAD Dojo  (explore)

Ranked Tuesday-night play on scratch copies of the real robot: rescue drills on sabotaged parts and student-vs-agent modeling duels, all graded mechanically by the kernel — mass properties and what survives the tug (merges #12, #28).

- **Mechanic:** Drills: the agent clones a real team part into a disposable studio, injects one authentic defect (removed constraint, magic-number dimension, fragile feature order), and the student diagnoses and repairs with a graduated hint ladder; the fix is verified by re-running the change that used to break it, and results post to training_certifications. Duels: student and agent model the same spec — sourced from the team's real BOM and gearbox numbers, never invented parts — in parallel workspaces; an automated judge checks mass properties and tugs two driving dimensions; the agent's think-aloud replay unlocks only after the student submits and must name one thing the agent's tree does better and one worse before the result counts on the ladder.
- **Teaching loop:** Desirable difficulty wrapped in a ladder a 14-year-old voluntarily shows up for; attempt-first unlocking of the worked example at the moment of peak receptivity; fully mechanical grading (rebuild errors, mass props) keeps all judgment honest.
- **Builds on:** Onshape tools + the disposable-doc convention, gearbox.ts/bom-cost-rollup/weight-budget.ts for specs, /training (0250), a new org-scoped RLS ladder table per the 0024 pattern. Explore: needs clone/branch, defect-injection, mass-properties, and tug tools plus genuine game design — the largest tool-surface gap in the portfolio.

## Rejected (and why — keeps the judgement honest)

- #31 Trap the Bot — rejected. A deliberately-nearsighted agent poisons trust in the same agent the team relies on for real design review: once students learn the bot's competence is secretly variable, every future verdict gets discounted, and 'is it nerfed right now?' is a question the product should never make a 14-year-old ask. The red-team energy survives in the CAD Dojo, where the judge is mechanical, and the honesty line it violated became principle 12.
- #24 Juniors-First Review Facilitator — rejected as a product surface. Software cannot enforce speaking order in a physical shop room, and mentors will rightly resent an app locking their input fields mid-meeting; the social protocol is unenforceable theater. Its genuinely valuable parts — the agent pre-reading the model, junior commit-before-reveal forms, hard question packs, the live tug in front of the room — are fully absorbed by Design Defense and the flagship.
- #7's help-economy framing — rejected in part. Putting a visible 'price' on hints trains help-avoidance, which the ITS literature flags as just as maladaptive as help-abuse; teenagers already under-ask. We keep the append-only learning ledger, the graduated ladder, and the foreman dashboard (shipped as The Apprentice Ledger) but drop the economy metaphor entirely: hints are logged, not billed.
- #30's stealth framing — rejected in part. Silently scoring minors' conversations for a mentor-only dashboard crosses a consent line. Prompt Forensics ships inside The Apprentice Ledger only with full student visibility ('how you talk to the robot', with example prompts from stronger sessions); the instrumentation stays, the secrecy goes — codified in principle 10.
- #13 Deadline Debt Ledger as a standalone product — folded into The Forgetting Agent rather than shipped alone: a debt ledger without the autonomy ratchet and repayment coaching reads as guilt-tracking, not teaching.
- Near-duplicate consolidation for honesty of count: #1/#8/#17 (tug test), #5/#15/#20 (prediction-gated calculators), and #9/#10 converged from five independent lenses into the flagship — that convergence was treated as evidence for the concept, not as five separate ideas; likewise #4+#25, #6+#14, #16+#18+#19, #21+#22, #26+#32, #11+#29+#13, and #12+#28 each merged into single portfolio entries.

## Appendix: full pedagogy brief

# Learning Science & Intelligent Tutoring Foundations for an AI Shop/CAD Mentor

Research brief for an AI agent that teaches mechanical design, CAD, and shop skills to high-school robotics students while also being capable of doing the work itself.

---

## 1. Intelligent tutoring systems that worked — the mechanics that moved learning

**Cognitive Tutor / MATHia (Anderson, Koedinger, Carnegie Learning).** Built on ACT-R cognitive models of the skills being learned. Students using Cognitive Tutor outscored peers by ~0.3 SD on standardized tests, with the largest gains on problem-solving and multiple-representations items (Ritter, Anderson, Koedinger & Corbett 2007). The RAND "Effectiveness of Cognitive Tutor Algebra I at Scale" RCT confirmed gains in year two of implementation. The load-bearing mechanics were NOT chat — they were:
- **Model tracing**: the system tracks the student's solution path step-by-step and gives feedback *on each step*, not just the final answer.
- **Knowledge tracing + mastery learning**: a per-skill probability estimate gates progression; students practice a skill until mastered, and stop practicing what they already know.
- **Hints on demand, in graduated levels** (pointing → conceptual → bottom-out), so help cost is explicit and minimal help is tried first.
- **VanLehn (2011)** meta-review: step-based tutoring (d = 0.76) is nearly as effective as human tutoring (d = 0.79); the "granularity of interaction" — feedback at the level of the *step the learner just took* — is the active ingredient, and finer-than-step interaction added nothing.

**ASSISTments.** The SRI/WestEd efficacy RCT (43 Maine schools) showed significant gains in end-of-year standardized math, with the *biggest gains for lower-performing students*. Mechanic: immediate correctness feedback on homework + hints/tutorials, and **teacher-facing reports** that changed next-day instruction. The system "assists while it assesses" — the data loop back to the human teacher was part of the effect.

**Khanmigo (Khan Academy).** Deliberate Socratic guardrails: it refuses to hand over answers; "what's the answer to question 3" gets "what have you tried so far?" It asks the student to propose the first step, then coaches from the student's own attempt. It is sandboxed to educational content, with parent/teacher chat visibility. The design bet: an LLM's default helpfulness is anti-pedagogical and must be inverted by system design.

**Duolingo Max "Explain My Answer".** GPT-4 explains *why the learner's specific answer* was right or wrong, on demand, in a bounded chat; human experts author the scenarios and the opening prompt, aligned to where the learner is in the course, and quality is gauged by how quickly the learner can return to the lesson. Mechanic: error-contingent, learner-initiated, curriculum-anchored explanation — not open-ended chat.

**Takeaway:** what moved learning was (a) feedback at step granularity on the learner's own work, (b) mastery-gated practice on a skill model, (c) graduated hints that make the learner act first, (d) refusal to short-circuit the attempt, and (e) explanations anchored to the learner's actual error.

## 2. Apprenticeship, worked examples, scaffolding, and practice science

**Cognitive apprenticeship (Collins, Brown & Newman 1989; Collins, Brown & Holum 1991).** Make expert *thinking* visible the way a shop makes expert *hands* visible. Six methods: **modeling** (expert demonstrates while thinking aloud), **coaching** (feedback/hints during the student's attempt), **scaffolding + fading** (support that is progressively withdrawn), **articulation** (student verbalizes their knowledge/reasoning), **reflection** (compare their process to the expert's), **exploration** (push students to frame problems themselves). Plus sequencing principles: increasing complexity, increasing diversity, global-before-local skills (see the whole task before drilling parts).

**Worked-example effect and fading (Sweller; Renkl; Kalyuga).** Novices learn more from studying worked examples than from unsupported problem solving (cognitive load); but the **expertise reversal effect** means examples become redundant, even harmful, as competence grows. The validated bridge is **fading**: worked example → completion problems (learner fills in progressively more steps, typically backward-faded) → independent solving. Renkl & Atkinson showed smooth example-to-problem transitions beat abrupt ones. Maps directly onto **"I do / we do / you do"** (gradual release of responsibility) and Vygotsky's ZPD: keep the task just beyond solo ability, with support calibrated and *always decaying*.

**Self-explanation (Chi).** Prompting learners to explain examples/steps to themselves reliably improves learning; good students spontaneously self-explain, weak ones don't — prompts close the gap. Chi's **ICAP framework**: learning outcomes ordered Interactive > Constructive > Active > Passive; generating (explaining, predicting, critiquing) beats receiving.

**Doer effect (Koedinger et al.).** Doing interactive practice has roughly **six times** the effect on learning of reading/watching, replicated and shown causal in large courseware datasets. Watching an AI do the work is the weakest condition in the whole literature.

**Desirable difficulties (Bjork & Bjork).** Retrieval practice (testing-effect meta-analyses ~g = 0.7 vs restudy), spacing, interleaving, and contextual variation impair immediate performance but improve retention and transfer. Corollary: fluent, frictionless help feels good and teaches little; learners systematically misjudge easy conditions as better learning.

## 3. CAD education specifically

**What makes CAD hard.** The research consensus: commands are the easy part; the hard part is **strategic knowledge** — planning the model. Chester (2007) distinguishes declarative (button-picks) from strategic knowledge and shows most instruction teaches only the former. **Design intent** — choosing datums, sketch relations, constraints, and feature order so the model changes *correctly* when a parameter changes — is the core expert skill (Otey/Company et al., "Revisiting the design intent concept in mechanical CAD education"). Salehi & McMahon's survey of 150+ practitioners: 76% found it difficult to recover design parameters/relationships from others' models. Rynne & Gaughran and Hartman (2004) show experts plan feature trees around anticipated change and reuse; novices model "what it looks like" and produce brittle trees that explode on edit. Company/Contero's work on **parametric modeling strategies for reusability** frames CAD quality as a measurable outcome (validity, completeness, consistency, conciseness of the tree).

**How the big curricula teach.** Onshape's Learning Center: self-paced pathways, per-tool courses plus "Onshape Fundamentals," instructor curriculum (Intro to CAD) with exercises/quizzes, and Associate/Professional certifications; the pedagogy is practice-exercise-centric with immediate hands-on modeling from unit 1. SolidWorks **CSWA**: a timed (3 h) exam where you model parts from drawings and answer with **mass properties** (mass, center of mass after a dimension change) — a clever assessment because a correct mass proves correct geometry *and* the parameter-change questions prove working design intent, gradable automatically. Autodesk Fusion offers similar self-paced project pathways and certification. Notably all three assess artifacts, not process.

**Critique/assessment of the learner's own model.** An emerging research thread does exactly what an AI mentor should: auto-assessment tools that (a) check geometry against target (mass-properties comparison) and (b) **test design intent by programmatically changing driving dimensions via the CAD API and checking the model updates correctly** (Kirstukas; "Auto-assessment tools for mechanical CAD education," Heliyon 2019; "Automatized Evaluation of Students' CAD Models," Educ. Sci. 2021; "Automated Assessment Tool for 3D CAD Models," Appl. Sci. 2024). Students and teachers rated the fast-feedback loop highly; teachers shifted time from grading to coaching. Ramos et al. show teaching explicit "rules of design intent" transfers. This validates a mentor that opens the student's feature tree, tugs on parameters, and critiques what breaks.

## 4. Engineering-design pedagogy in elite FRC teams

- **971 Spartan Robotics — Spartan Series**: 60+ public workshop videos/slides by students and mentors ("Mechanical Design for Controllability," "Complexity Index and Design Philosophy," robust CAD methods, manufacturing, localization). Pedagogy: post-season reflection turned into teaching artifacts; design decisions justified from physics and controllability, not aesthetics.
- **1678 Citrus Circuits — Fall Workshops + released training courses**: Corsetto's "Strategic Design" deck is the canonical FRC design-teaching artifact: start from game analysis and scoring math, derive robot requirements, THEN design mechanisms; "Keep It Simple" as an explicit capability-matching discipline; prototyping cadence with cheap materials before CAD commitment.
- **254 / JVN / Spectrum 3847**: JVN's blog and his **Mechanical Design Calculator** (motor/gearbox/drivetrain/linear/rotary sizing spreadsheet, now echoed by ReCalc and Onshape4FRC calculators) function as *teaching tools*: they make the governing equations (torque, current draw, speed) manipulable, so students explore tradeoffs numerically before building. Spectrum 3847 publishes ~200 slides of "Spectrum Design Concepts" (weekly fall design classes), a Robot Design Sheet, and full Open Alliance build blogs documenting strategy → prototype → iterate in public.
- **118 Everybot**: an annually published, fully documented minimal competitive robot for low-resource teams — pedagogically a **worked example at robot scale**: a complete, buildable reference design whose every choice is explained, from which teams learn the game's essential mechanisms.
- Common mentor-team practices: scheduled **design reviews** where students present and defend CAD to mentors; strategy-first requirements; rapid prototyping cadence ("build the risky mechanism in wood by week 1"); post-season teach-backs. The teacher role is critic-and-questioner; students own the geometry.

## 5. The automation-vs-learning tension

- **Bastani et al., PNAS 2025 ("Generative AI without guardrails can harm learning")**: ~1,000 Turkish HS students; unfettered GPT-4 ("GPT Base") boosted practice performance +48% but **-17% on the subsequent unaided exam** vs never having AI; a guardrailed "GPT Tutor" (teacher-designed hints, no answer reveal) captured the practice gains (+127%) with the learning harm largely eliminated. Direct answers are a crutch; hints are not.
- **Copilot novice studies** (Prather et al., "Widening Gap"; Barke/"It's Weird That it Knows What I Want"): novices exhibit **"shepherding"** (rarely writing own code) and **"drifting"** (cycling suggestions without progress); least-experienced users accept the most suggestions; perceived productivity diverges from actual understanding; automation bias and verification overhead are documented harms — but Copilot can serve as a metacognitive scaffold if the human does the planning/decomposition.
- **Fan et al., BJET 2025 ("metacognitive laziness")**: RCT comparing ChatGPT vs human expert vs checklist support — ChatGPT improved short-term task performance but not knowledge gain/transfer, and reduced self-regulation (planning, monitoring, evaluating).
- **Keep-the-learner-in-the-loop mechanisms with evidence or strong precedent**: guardrailed hint ladders (Bastani; Cognitive Tutor); "what have you tried?" attempt-first gating (Khanmigo); pseudo-code/scaffold instead of runnable solution (CodeAid, ICER 2024); assessment-aware tutor design principles (PeteChat design case); error-contingent explanation of *the learner's* answer (Duolingo Max); prediction-before-observation prompts (ICAP: constructive > active; predict-observe-explain tradition); the pair-programming **driver/navigator** framing — the student drives the mouse and the tools, the AI navigates and spots.

---

## Design principles for an AI shop mentor (each: principle + why)

1. **The student's hands stay on the tools — the mentor coaches, spots, and only demos on request, then hands control back.** The doer effect (~6x doing vs. reading) and Copilot "shepherding" evidence show that watching an agent work is the weakest learning condition available.
2. **Never give the answer to an active attempt; give the smallest graduated hint that lets the student take the next step.** Bastani et al. showed answer-giving AI produced worse unaided performance than no AI, while hint-based guardrails preserved learning; Cognitive Tutor's hint ladders are the proven pattern.
3. **Require an attempt or a prediction before helping ("what have you tried?" / "what do you think happens if…").** Attempt-first gating (Khanmigo) and constructive engagement (ICAP) reliably beat passive receipt, and prediction makes the subsequent explanation stick.
4. **Give feedback at step granularity on the student's own artifact — their sketch, their feature tree, their gearbox — not generic lessons.** VanLehn's meta-review pinpoints step-level interaction as the active ingredient that makes ITS rival human tutors, and Duolingo Max shows error-contingent explanation is what learners actually use.
5. **Teach by fading: full worked example → completion tasks ("I've made the base sketch; you add the pocket and fillets") → solo, with support withdrawn as mastery grows.** The worked-example effect helps novices but reverses with expertise, so a fixed help level is wrong for everyone; fading is the validated schedule.
6. **Track a per-skill mastery model (sketching, constraints, mates, tolerances, DFM…) and use it to pick tasks and calibrate help.** Knowledge tracing + mastery learning is what let Cognitive Tutor/MATHia produce 0.3 SD gains — practice targets what's unlearned and stops when it's learned.
7. **Critique design intent by tugging on the model: change a driving dimension, show what breaks, and have the student explain and fix it.** CAD research says strategic knowledge/design intent — not button-picks — is the hard part, and API-driven parameter-change assessment is a validated, automatable critique method (also exactly how CSWA proves competence).
8. **Make expert thinking audible: narrate the why (loads, tolerances, edit-resilience, manufacturability) whenever the mentor models a step.** Cognitive apprenticeship's core move is making invisible expert reasoning visible; a silent demo teaches keystrokes, not judgment.
9. **Prompt self-explanation and articulation at decision points ("why did you dimension from that face?"), and run design reviews where the student defends choices.** Self-explanation is one of the most robust effects in learning science, and mentor-led design reviews are how 971/1678/254-class teams actually transmit design judgment.
10. **Anchor every skill in the student's real robot goal — strategy → requirements → mechanism — rather than decontextualized exercises.** Citrus Circuits' strategic-design pedagogy and cognitive apprenticeship's "global before local" both show motivation and transfer come from seeing where the piece fits.
11. **Use calculators and reference designs as manipulable worked examples (JVN-calc-style sizing, Everybot-style complete designs), asking the student to run the numbers and predict before revealing.** FRC's best teaching artifacts work because they externalize governing equations and full solutions for interrogation, not copying.
12. **Preserve desirable difficulties: space and interleave practice, quiz recall of earlier concepts, and resist smoothing away all struggle — while detecting and rescuing *unproductive* struggle.** Retrieval practice and spacing (~g = 0.7) beat re-exposure, and learners' preference for frictionless help is precisely the trap the mentor must not automate into.
13. **When the agent does do real work (deadline mode), make it a teachable act: explain-before-apply, show the diff to the model, and schedule a follow-up "you redo a version of this" retrieval task.** Metacognitive-laziness and Copilot studies show unexamined AI output produces short-term wins and no learning; explanation plus later re-doing converts delivered work back into practice.
14. **Close the loop with human mentors: surface each student's mastery map, struggle points, and help usage to the team's adult mentors.** ASSISTments' efficacy came partly from teacher-facing reports changing instruction — the AI is a layer in an apprenticeship community, not a replacement for it.

---

## Sources

**ITS / tutors that worked**
- Ritter, Anderson, Koedinger & Corbett, "Cognitive Tutor: Applied research in mathematics education" — https://pact.cs.cmu.edu/koedinger/pubs/Ritter%20Anderson%20Koedinger%20Corbett%202007.pdf
- WWC Cognitive Tutor intervention report — https://ies.ed.gov/ncee/wwc/Docs/InterventionReports/wwc_cognitivetutor_062116.pdf
- Pane et al., "Effectiveness of Cognitive Tutor Algebra I at Scale" — https://www.researchgate.net/publication/259639036_Effectiveness_of_Cognitive_Tutor_Algebra_I_at_Scale
- Ritter et al., "MATHia X: The Next Generation Cognitive Tutor" — https://www.educationaldatamining.org/EDM2016/proceedings/paper_187.pdf
- VanLehn 2011, "The Relative Effectiveness of Human Tutoring, Intelligent Tutoring Systems, and Other Tutoring Systems" — https://www.tandfonline.com/doi/full/10.1080/00461520.2011.611369
- ASSISTments efficacy (SRI/WestEd, Maine RCT) — https://www.wested.org/support/efficacy-of-assistments-online-homework-support-for-middle-school-mathematics-learning/ and https://www.assistments.org/evidence-of-impact
- ASSISTments immediate-feedback crossover study — https://www.researchgate.net/publication/286195590_Does_immediate_feedback_while_doing_homework_improve_learning
- Khanmigo Socratic design — https://www.freethink.com/consumer-tech/khanmigo-ai-tutor and https://aiforcause.org/stories/khanmigo-ai-tutor and https://www.khanmigo.ai/parents
- Duolingo Max design (OpenAI case study; Tech&Learning PM interview) — https://openai.com/index/duolingo/ and https://www.techlearning.com/how-to/what-is-duolingo-max-the-gpt-4-powered-learning-tool-explained-by-the-apps-product-manager

**Apprenticeship / practice science**
- Collins, Brown & Holum, "Cognitive Apprenticeship: Making Thinking Visible" — https://www.aft.org/ae/winter1991/collins_brown_holum
- Collins, Brown & Newman report — https://ocw.metu.edu.tr/pluginfile.php/9107/mod_resource/content/1/Collins%20report.pdf
- Renkl et al., "How Fading Worked Solution Steps Works" — https://www.researchgate.net/publication/225917831_How_Fading_Worked_Solution_Steps_Works_-_A_Cognitive_Load_Perspective
- Kalyuga et al., "The Expertise Reversal Effect" — https://mrbartonmaths.com/resourcesnew/8.%20Research/Explicit%20Instruction/The%20Expertise%20Reversal%20Effect.pdf
- Chi & Wylie, "The ICAP Framework" — https://education.asu.edu/sites/g/files/litvpz656/files/lcl/chiwylie2014icap_2.pdf
- Bjork & Bjork, "Introducing Desirable Difficulties into Practice and Instruction" — https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-introducing-desirable-difficulties-into-practice-and-instruction-bjork-and-bjork.pdf
- Retrieval-practice meta-analytic evidence — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10698739/
- Doer effect (causal replication) — https://dl.acm.org/doi/pdf/10.1145/3576050.3576103 and https://www.researchgate.net/publication/353463711_The_Doer_Effect_Replicating_Findings_that_Doing_Causes_Learning

**CAD education**
- Otey, Company et al., "Revisiting the design intent concept in the context of mechanical CAD education" — https://www.researchgate.net/publication/318807581_Revisiting_the_design_intent_concept_in_the_context_of_mechanical_CAD_education
- Camba, Contero & Company, "Parametric CAD modeling: An analysis of strategies for design reusability" — https://www.sciencedirect.com/science/article/abs/pii/S0010448516000051
- Rynne & Gaughran / model attributes exercise — https://www.sciencedirect.com/science/article/abs/pii/S0360131511000807
- "The importance of adaptive expertise in CAD learning: maintaining design intent" — https://www.researchgate.net/publication/327553707_The_importance_of_adaptive_expertise_in_CAD_learning_maintaining_design_intent
- Ramos et al., "Learning CAD at university through summaries of the rules of design intent" — https://link.springer.com/article/10.1007/s10798-016-9358-z
- "Auto-assessment tools for mechanical CAD education" (design-intent API testing) — https://pmc.ncbi.nlm.nih.gov/articles/PMC6820095/
- "Automatized Evaluation of Students' CAD Models" — https://www.mdpi.com/2227-7102/11/4/145
- "Automated Assessment Tool for 3D CAD Models" — https://www.mdpi.com/2076-3417/14/11/4578
- Onshape education / Learning Center — https://www.onshape.com/en/education/courses-curriculum and https://learn.onshape.com/
- CSWA exam structure — https://blogs.solidworks.com/teacher/2025/08/lesson-7-solidworks-academic-certification-cswa-exam-part-2.html and https://static.sdcpublications.com/pdfsample/978-1-58503-656-1-3.pdf

**FRC design pedagogy**
- 971 Spartan Series workshops — https://www.frc971.org/spartan-series and https://www.chiefdelphi.com/t/2025-spartan-series-workshops-videos-and-slides-are-now-available/508863
- 1678 Strategic Design (Corsetto) — https://www.citruscircuits.org/uploads/6/9/3/4/6934550/strategic_design_2018.pdf
- 1678 training resources release — https://www.chiefdelphi.com/t/1678-citrus-circuits-training-resources-release/440322
- JVN Mechanical Design Calculator — https://www.chiefdelphi.com/t/paper-jvns-mechanical-design-calculator/124333 and https://gm0.org/en/latest/docs/power-and-electronics/motor-guide/jvn-calculator.html
- Spectrum Design Concepts (~200 teaching slides) — https://spectrum3847.org/spectrum-design-concepts/ and https://www.spectrum3847.org/resources/spectrum-resources
- 118 Everybot — https://www.118everybot.org/ and https://robonauts-everybot.github.io/Everybot-Docs/manual/the-everybot/

**Automation vs. learning**
- Bastani et al., PNAS 2025, "Generative AI without guardrails can harm learning" — https://www.pnas.org/doi/10.1073/pnas.2422633122 (preprint: https://hamsabastani.github.io/education_llm.pdf)
- Prather et al., "The Widening Gap: Benefits and Harms of Generative AI for Novice Programmers" — https://arxiv.org/pdf/2405.17739
- Barke et al., "It's Weird That it Knows What I Want" (Copilot usability, novices) — https://dl.acm.org/doi/10.1145/3617367
- Fan et al., BJET 2025, "Beware of Metacognitive Laziness" — https://bera-journals.onlinelibrary.wiley.com/doi/10.1111/bjet.13544
- Kazemitabaar et al., "CodeAid: Classroom Deployment of an LLM Assistant that Balances Student and Educator Needs" — https://arxiv.org/pdf/2401.11314
- "Tutor, Not Solver: Designing a Guardrailed AI Assistant (PeteChat)" — https://arxiv.org/html/2606.09845v1
- "Exploring Student Behaviors and Motivations when using AI Teaching Assistants with Optional Guardrails" — https://arxiv.org/pdf/2504.11146