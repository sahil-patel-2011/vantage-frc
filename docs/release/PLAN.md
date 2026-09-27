# Vantage: complete, tested, and running in production

## 1. Finish line and fixed decisions

This is the complete implementation and release plan. The finish line is a functioning production app with verified workflows, automatic team provisioning, personal Codex connections, recoverable backups, updated policies, and working operational monitoring.

The run continues through implementation, testing, fixes, deployment, and production verification. A successful build, attractive screens, or mocked integration tests alone do not establish completion.

Decisions already settled:

- PostgreSQL is the live database; your Google account holds team workbooks and a complete recoverable second copy.
- PostgreSQL can move to your NAS later. The initial production release does not depend on that future hardware.
- Codex connections belong to individual people and use their own accounts and devices.
- Scouting partner sharing is opt-in; team data is private by default.
- Photo/video uploads and storage options are removed; external match-video links remain.
- Launch eligibility is **age 13 or older**.
- Keep the current model-training opt-out, clearly disclosed and enforced.
- Open self-service signup when production acceptance passes, replacing the October 19 date restriction.
- Onshape, Fusion, and GitHub remain specialist editing environments connected to Vantage.

Start by inventorying every existing route, feature manifest, database table, connector, and scheduled job. Create a completion matrix covering real data, permissions, user actions, failure handling, mobile usability, offline requirements, backup coverage, and acceptance evidence.

Every shipped feature must pass that matrix. Consolidate duplicate tools into complete workflows and preserve existing links with redirects. No hidden placeholders, invented metrics, or silently skipped failures count as finished.

## 2. Complete the product and shared UI

### Scouting and strategy

Independently implement the useful behaviors reviewed in Lovat’s public collection and dashboard code, then improve their transparency, reliability, and connection to team operations. [Collection code](https://github.com/HighlanderRobotics/lovat-collection), [dashboard code](https://github.com/HighlanderRobotics/scouting_dashboard_app).

- **Collection:** pre-match setup, auto, teleop, endgame, and review; contextual counters, duration actions, positions, undo, autosave, crash recovery, and season-configured timing. Keep custom forms.
- **Action history:** versioned timestamped observations survive offline submission, QR transfer, exports, and backups alongside existing form payloads.
- **Aggregation:** combine reports for the same robot and match before computing averages; retain disagreements and distinguish missing observations from recorded zeroes.
- **Robot profiles:** Overview, Matches, Capabilities, and Notes, supporting counters, timers, ratings, selections, positions, and paths. Raw observations remain visible without a scoring formula.
- **Presentation:** every metric explains its units, definition, source, sample count, filters, and supporting matches. Tables, charts, profiles, and strategy use the same computation model.
- **Comparison:** persistent three-team comparison with consistent scales and real event, match, and source filtering.
- **Pick lists:** adjustable metrics, personal/shared presets, ranking explanations, manual tiers, selection state, and revision checks. New data offers recalculation without unexpectedly moving the selection board.
- **Match planning:** six-robot capabilities, autonomous paths, assigned roles, scoring ranges, and uncertainty. Save an offline briefing without presenting unsupported predictions as facts.
- **Lead desk:** assignments, backups, coverage, queued reports, quarantined submissions, disagreements, and training.
- **Partner sharing:** explicit dataset grants, revocation, provenance, and exclusion of scout identities and private notes.

Benchmark collection, transfer, and assignment workflows against Lovat, QRScout, and ScoutRadioz; compare statistical presentation with Statbotics. Measure workflow speed, reliability, explanation quality, and navigation effort rather than claiming universal superiority without evidence.

### Complete the connected team workflows

| Area | Required finished workflow |
|---|---|
| Home | Preserve saved boards and real APIs; useful defaults show next match, personal work, and blockers. |
| Event day | Schedule, personal assignments, readiness, briefing, and pit status share the selected event. |
| Work | One canonical task record with ownership, due dates, dependencies, history, and source links. |
| Chat and playbook | Turn messages into linked tasks or saved decisions; search and permissions work consistently. |
| Parts and repairs | Connect design quantities, stock, purchasing, receiving, checkout, failures, and repair consumption. |
| Pit and batteries | Checks, charge plans, readiness, failures, and responsible people form one usable workflow. |
| CAD and code | Working pairing/authentication, selected document or repository, job progress, outputs, and specialist-editor links. |
| Learning | Exercises, saved progress, mentor feedback, and links to relevant team work. |
| Finance | Separate budgets, spending, commitments, and requests; totals drill into actual ledger records. |
| Sponsors and grants | Owners, next actions, deadlines, deliverables, evidence, and connections to finance and tasks. |
| People and logistics | Invitations, roles, hours, calendar, travel, packing, and responsibilities work end to end. |
| Account and administration | Profile, security, personal connections, export, deletion, team settings, and operational status work with proper authorization. |

Benchmark task handling against Trello, inventory against CheesyParts and Sortly, event readiness against Nexus, knowledge against Notion, and sponsor follow-up against HubSpot. Preserve existing financial and inventory transaction guarantees.

### UI and usability

Use neutral surfaces, restrained teal accents, clear typography, consistent charts, generous spacing, and strong status colors only where attention is needed.

Primary navigation becomes **Home, Competition, Team, Build, Business**. Logistics belongs within Team. Competition exposes **Event day, Scout, Teams, Strategy, Pit**; advanced tools sit inside the appropriate workspace.

Use one dominant action per screen, plain labels, consistent units, and competition controls at least 48 pixels wide/high. Remove repeated navigation bars and decorative metrics.

Phone detail views fill the screen. Back restores filters and scroll position. Every relevant screen distinguishes:

- Saved on this device
- Waiting to upload
- Uploaded
- Needs attention

Complete keyboard access, visible focus, contrast, reduced-motion support, and readable layouts on phones, tablets, and desktops. Preserve `DashboardHomeView` and the actual saved-board APIs.

## 3. Provisioning, redundancy, Codex, and media

### Automatic team setup

Extend the existing onboarding and Google Sheets hub.

After email verification and age eligibility, a user creates a team or joins an existing team through an invitation or approved request. Creating a team starts one persistent, idempotent provisioning job that:

1. Creates the organization, owner, roles, and access settings.
2. Creates the team’s folder in your Google account.
3. Creates labeled workbooks and initializes every core feature.
4. Registers resource IDs and schema versions.
5. Writes and verifies the initial recovery copy.
6. Marks readiness only after read-back checks succeed.
7. Redirects immediately into Home.

Joining a team never reprovisions it. Concurrent requests for the same team resolve through its unique identity.

Use this Drive structure:

```text
VantageFRC/
  Teams/
    <number> - <name> - <stable organization ID>/
      Start Here
      Competition
      Team
      Build
      Business
  Recovery/
    <protected snapshots and change journals>
```

Workbooks have descriptive tabs, labeled columns, frozen headers, filters, units, stable IDs, source timestamps, and a table catalog. Defaults include scouting templates, dashboard layouts, task statuses, inventory units, calendar settings, and finance categories.

Target approximately five minutes under the acceptance load. Show a progress ring with real phases and rotating factual app tips. Do not invent percentage progress or impose a minimum wait.

Provisioning survives refreshes, interrupted execution, and retries without duplicate resources. Correct the current helper that can return a workbook before every table succeeds. Failed phases retain completed work and expose a retry action.

Use durable execution for setup and background coordination on the existing Vercel deployment, with PostgreSQL retaining application job state. Implement resumable steps using the Vercel Workflow SDK; validate deployment support and resource limits before release. Ordinary in-process timers cannot provide reliable serverless background execution. [Vercel durable workflows](https://vercel.com/academy/build-ai-agent-harness/durable-workflows).

### Complete Google redundancy

Maintain two distinct copies:

- **Readable team workbooks:** understandable operational records.
- **Protected recovery workbooks:** lossless data sufficient to rebuild PostgreSQL.

Cover all durable application tables, relationships, deletions, schema definitions, and required sequence state. Add an automated coverage check so new tables cannot silently escape backup.

Commit change events with application changes. Export ordered batches with checkpoints, integrity checks, and idempotent replay. Include consistent snapshots and seven daily/four weekly retention slots, with a maximum snapshot age of 28 days.

Target recovery-journal lag below one minute and readable-workbook freshness below five minutes under acceptance load. Show actual lag and failures.

Preserve precision, timestamps, large JSON, and long text with reversible encoding and sharding. Remove silent truncation. Write user content as values rather than executable formulas.

Encrypt authentication records, private conversations, and credential-bearing recovery data. Keep recovery keys outside Sheets. Restrict Google workbook access to the operator by default; application roles continue controlling team access.

Deletion must propagate to current mirrors. Expiring backups and replayed deletion records prevent restored data from becoming visible again. A restored installation revokes sessions, device credentials, and outstanding jobs before reopening access.

Batch Google operations across the owner account and test throttling/backoff against documented quotas. [Google Sheets limits](https://developers.google.com/workspace/sheets/api/limits).

Deliver a tested NAS migration runbook covering secure connectivity, persistent storage, restore/replication, consistency checks, connection switching, and rollback.

### Personal Codex

Support both directions:

- Codex terminal calls Vantage through its MCP server.
- Vantage sends a person’s AI requests to their own paired local Codex.

Extend the existing connector’s setup, status, supervision, and MCP commands. Provide guided personal setup and a real connection test.

Enforce requesting-user and organization identity through device selection, claiming, polling, cancellation, and result access. Remove team-wide subscription fallback and isolate profiles on shared computers.

Keep Codex credentials local. Show accurate disconnected, unauthenticated, offline, rate-limited, running, and failed states. Use supported App Server streaming and approval behavior.

Expose typed feature tools through existing application services and permissions. Mutations present the proposed action through the supported approval mechanism. Never expose unrestricted SQL, Google owner credentials, or arbitrary platform shell execution.

Keep unrelated terminal conversations outside Vantage. Only submitted Vantage requests and permitted tool activity enter its records.

### Media removal

Remove photo/video upload, capture, recording, storage setup, quotas, and media-outbox UI. Disable server mutation endpoints and retire unused workers and connector capabilities.

Keep external video links, timestamps, notes, and supported analysis. Preserve existing stored records without silent deletion. Keep supported documents and CAD artifacts separate from removed media storage.

## 4. Rewrite Terms of Service and Privacy Policy

Rewrite both documents from the final implemented behavior, using conventional headings, concise paragraphs, and straightforward language.

Remove implementation commentary, strange phrasing, unsupported absolutes, and explanations of unfinished decisions. For example, use “Passwords are hashed” instead of “one-way scramble.”

### Terms of Service

Cover eligibility, account responsibilities, team administration, content ownership and service permissions, acceptable use, AI and third-party services, current pricing, suspension, termination, service availability, warranties/liability, updates, and contact.

Describe self-service signup, age 13+ eligibility, personal Codex, and removed media storage accurately. Preserve the actual pricing model and distinguish Vantage charges from external provider costs.

Do not invent a company identity, jurisdiction, arbitration requirement, or governing-law selection. Omit an unselected choice-of-law clause instead of publishing the current “deliberate blank” explanation.

### Privacy Policy

Cover operator/contact information, collected data, purposes, team and personal visibility, sharing/providers, AI processing, analytics/cookies, PostgreSQL and Google backups, security, retention, account/team deletion, user requests, age eligibility, and updates.

Explicitly disclose that your operator-controlled Google account holds recovery copies, including encrypted sensitive records. Explain the distinction between personal privacy inside the product and necessary operator access.

Keep model-training opt-out as requested. State clearly what AI activity may be used, how the team disables training, when the choice takes effect, and what withdrawal can and cannot undo. Enforce that choice through collection, dataset preparation, exports, and training jobs.

Keep existing analytics consent behavior unless an accuracy fix is required. Update marketing, onboarding, settings, and help text alongside the policies so they do not contradict one another.

Implement the age gate across signup, invitation acceptance, OAuth onboarding, and team creation. Handle known existing under-13 accounts through an eligibility review without silently deleting their data. Age restrictions must be reflected in actual collection and access behavior, not merely policy wording. [FTC children’s privacy guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions).

Complete self-service account export/deletion and authorized team export/deletion, with identity verification, session revocation, treatment of team-owned records, and backup retention explained accurately.

Keep `/terms` and `/privacy`, preserve linked anchors, and use the shared document source. Update effective dates and versioned acceptance records together. Existing users receive the appropriate update notice and renewed acceptance when material terms change.

## 5. Implementation, testing, and production launch

### Execution sequence

1. Establish the feature inventory, regression baseline, deployed configuration, and outstanding integration requirements.
2. Complete provisioning, backup coverage, recovery tooling, and background execution.
3. Complete personal Codex isolation, age eligibility, and media removal.
4. Complete scouting and every connected Team, Build, and Business workflow.
5. Apply the shared UI and finalize policies against the finished behavior.
6. Run release checks, repair failures, deploy through the established Git/Vercel process, verify production, and open signup.

Use additive migrations and preserve existing records. Development flags may support staged work, but unfinished features must not be disguised as completed by leaving flags off.

### Required testing

Run repository lint, workspace type checks, unit tests, migration checks, PostgreSQL integration tests, RLS proofs, production builds, and browser journeys. Fix failures caused by the work and investigate existing failures; do not weaken assertions or silently skip them.

Add meaningful coverage for:

- Provisioning interruptions, concurrent signup, retries, partial Google writes, and immediate completion redirects.
- Cross-team and cross-person access rejection.
- Codex authentication, execution, approvals, cancellation, revocation, and offline behavior.
- Scouting crash recovery, QR transfer, duplicate reports, conflicts, filters, missing values, and small samples.
- Purchasing-to-inventory-to-repair and sponsor-to-task-to-finance journeys.
- Age boundaries, policy versions, training opt-out, account deletion, and backup deletion handling.
- Media rejection through UI and API, plus retained external-video workflows.

Use scratch databases for destructive integration tests. Test real Google resources in a separate operator-owned test folder and remove only identified test resources afterward.

Restore an isolated PostgreSQL installation using only the Sheets recovery copy and separately held keys. Verify tables, relationships, deletions, types, and representative workflows.

Load-test 50 teams with 12 active scouting clients each, simultaneous setup jobs, and backup activity. Meet provisioning and backup-lag targets under normal provider availability.

### Production configuration and verification

The local production preflight currently reports eight missing required settings; that is not proof of the deployed host’s configuration. Inspect the actual deployment and close every platform dependency gap.

Require working database roles, sign-in email, authentication origins, Google provisioning, encryption/key services, reference-data ingestion, durable jobs, rate limiting, exports, notifications, and monitoring for the features shipped. Configure provider applications and callback URLs for supported connectors.

A user may still need to connect their own Codex, CAD, or GitHub account. A missing platform credential must not appear as a finished feature awaiting user setup.

Schedule and observe actual background work: backups, reminders, retention/deletion, reference refreshes, and other shipped recurring features. A cron route that exists but never runs does not pass.

Before migrations, take and verify a recovery checkpoint. Deploy only after preflight passes and application/schema compatibility is checked. Rollback restores the previous application release without destructively reversing additive migrations.

Verify the live production URL with controlled test accounts:

- Signup → provisioning → Home.
- Invitation → role-correct access.
- Email sign-in and enabled security flows.
- Offline scouting → reconnect → correct analysis.
- Personal Codex connection and execution.
- Core Team, Build, and Business journeys.
- Policy acceptance, export, and deletion.
- Reference-data updates, backup checkpoints, and worker recovery after restart.

Open signup only after these checks pass, then repeat the signup journey against the public entry point. Observe an operating cycle, inspect errors and job lag, and fix release regressions.

### Completion evidence

The final handoff includes the live URL, deployed revision, feature completion matrix, test results, production journey results, recovery proof, monitoring status, and operating/NAS runbooks.

No unresolved critical or high-severity defects remain in shipped workflows. Required integration failures block completion.

If an external credential, provider entitlement, or unavailable device prevents a required live check, report that exact dependency and finish all independent work. Do not describe the production app as complete until the remaining check succeeds.
