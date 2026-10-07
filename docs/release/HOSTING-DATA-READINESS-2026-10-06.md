# Hosting, primary storage and final acceptance

Status: cost controls implemented; primary-storage migration and production acceptance remain open.
This document supersedes earlier instructions to automatically run full acceptance on every ready PR and main push.

## Compute policy

- No laptop database, development server, build, unit runner or browser test runner.
- GitHub stores code. Web acceptance and desktop packaging have only manual dispatch triggers. Both repository workflows were disabled through GitHub, duplicate main run 37558430611 was cancelled, and repository Actions permissions now verify `enabled: false`. This prevents newly added workflows from running too.
- Vercel hosts the website. Git deployments are disabled for every branch. The project ignored-build command was set to `exit 0`, with previews disabled, before pushing these changes. The repository ignore script also skips every Git build.
- The repository has no scheduled Vercel crons. This source change does **not** prove existing deployed cron schedules have stopped: live Cron Jobs settings still need verification. Their old daily season job also dispatched research, reminders, spreadsheet copies and recovery work.
- An intentional deployment needs verified remaining free usage, compatible data/configuration, and the exact reviewed commit. Never infer free usage from plan documentation. Do not start another failed deployment to rediscover a known prerequisite.
- Manual-only workflows remain saved as future reference; that is not authorization to re-enable or run them. No new Actions run or local test/build was started for this change.

## Verified release state

The latest production attempt, `dpl_2v9mABu1XUv4NiUxvTi8y7eCbWJY`, targeted main commit `d9fecef406af0dec974d54daaec9f3cd61468986` and failed its read-only schema gate. Build logs report all four required migrations missing: 0710, 0711, 0712 and 0713. The last ready release reported by Vercel is commit `765ea9850ab16c4c795ff55784e05eaf7440de45`. Do not remove the gate to publish new queries against the old schema.

The authenticated Vercel billing report requested for October 1–7 returned a summary for September 30 07:00 through October 6 07:00 UTC with approximately $0.71 billed usage and $6.92 effective usage. This is team-level usage; it does not identify Vantage as the cause or prove remaining free allowance. Workflow, build and queue services have nonzero billed entries. Plan, spend cap and current remaining allowance still need verification in the hosting account.

No Vantage Next server, Vitest runner or Playwright CLI was present in the laptop process inspection. Unrelated user applications were left untouched.

## Google Sheets as primary storage

The desired destination is a private operator-owned Google Sheet until NAS storage is available. Its URL or authorization to create a new sheet, and deployable app access, are still required. The Codex connector's access alone does not authenticate the deployed website.

Current Sheets integration is an export/copy system, not primary persistence:

- `packages/db` and Better Auth use PostgreSQL.
- `connection-store.ts` keeps integration connections in PostgreSQL.
- `sheets-hub.ts` reads organization membership, provisioning state and domain rows through PostgreSQL, then writes five workspace books.
- Provisioning, readable-copy and recovery jobs start hosted Workflow runs.
- Existing row-level security, custom-role grants, once-only account onboarding, idempotent scouting uploads and recovery use SQL transactions and schema objects.

Replacing a connection URL or turning on Sheets sync cannot migrate this architecture. A real cutover must cover:

1. Account/session persistence and tenant membership lookup, including immediate revocation and cross-team denial.
2. Versioned records for organizations, roles, forms, scouting reports, assignments and all remaining workspace domains. Unknown observations must remain distinct from zero.
3. Concurrent writes, revision conflicts, idempotency keys and offline retry acknowledgements. A report is shown as uploaded only after durable primary-store acknowledgement.
4. Bounded reads, batched writes, quota backoff and explicit provider-unavailable states. No background polling of entire workbooks and no silent fallback to local or temporary databases.
5. An authorized export/import inventory, encrypted account-sensitive data where required, row-count/content verification and a recoverable cutover. Preserve existing records until the new store is proven.
6. A storage interface with equivalent semantics for the future NAS. Sheets is a concrete adapter, not a spreadsheet copy masquerading as primary storage.

[Google's Sheets API limits](https://developers.google.com/workspace/sheets/api/limits) must be checked against the intended team/user load. Sheets does not supply the application's existing PostgreSQL RLS enforcement; the replacement must enforce tenant access itself. No scale or zero-cost promise is established by this review.

## Hosted walkthrough evidence

The public production Home and Sign in pages render. The password/email-code toggle, recovery-email transition and team-code navigation work through the browser. Empty email/code controls remain disabled. No account or test team was created, no email was sent and no real user data was changed.

The user deferred signing in until later. Leave authenticated acceptance pending; do not request credentials or claim that those flows were verified.

The browser remained at 1280 × 720 despite an attempted viewport override, verified from its rendered document. This pass establishes desktop appearance only; do not count it as a mobile pass. Authenticated scouting, dashboard, team setup, roles and saved widgets cannot be walked through while the browser is signed out. They also cannot prove the unpublished main release.

## Product acceptance specification

The comparison target is [Lovat's published product](https://lovat.app/): focused collection, team summaries, alliance planning, predictions, shared pick lists and offline transfer. The site is a feature reference, not evidence that Vantage is better or equivalent.

| Workflow | Required useful behavior | Production evidence required |
| --- | --- | --- |
| New account/team | One clear entry path, correct invitation/team scope, recoverable setup, no returning walkthrough | Fresh account, existing account, second device, reload and team switch |
| Match collection | Reachable large controls, phase-relevant fields, draft recovery, explicit unknowns, correction history | Full autonomous/teleop/endgame capture, reload, airplane-mode recovery and primary-store readback |
| Forms | Clear preview, stable versions, defaults, publication permissions, no lost edits | Lead creates/publishes form; scout collects it; revoked lead is refused |
| Trends | Real event-filtered records, coverage/sample counts, observed climb outcomes and match progression | Change underlying reports and event; show matching totals and unknown coverage; never infer intentions |
| Team comparison | Traceable metrics, categorical capabilities and notes, source reports reachable | Compare robots with complete, partial and conflicting observations |
| Alliance strategy | User-controlled priorities, interpretable estimates, shared durable pick order | Two members edit; conflict/reload behavior; no fabricated prediction confidence |
| Home widgets | Real saved data, clear empty/error states, useful action and layout persistence | Create/edit/use each widget; reload and cross-team isolation |
| Roles | Named scouting lead preset and custom capabilities, clear owner controls | Grant/apply/revoke across two accounts and two teams; no unrelated admin access |
| Polish | Consistent hierarchy, restrained color, readable spacing, keyboard/focus semantics, subtle dismissal | Phone/desktop, light/dark, reduced motion, keyboard and touch; overlays restore focus |
| Remaining workspaces | One canonical destination per task, explicit configuration states, durable mutations | Walk every visible action with real fixtures; no duplicate pages or fake success states |

The prior isolated acceptance results are useful regression history, but they do not establish the new Sheets architecture, current production configuration or complete live-provider behavior. Production readiness, the Google Sheets migration, live cron shutdown and a successful final deployment are still unverified.
