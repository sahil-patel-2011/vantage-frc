/**
 * Reviewed exceptions to the tenancy checks in scripts/security-boundaries.mjs.
 *
 * Each entry is a suppression. A new file that imports a worker module, calls
 * requestPool outside withRls, or interpolates a SQL template fails until a
 * row is added here with a reason. An entry whose file no longer does the
 * thing it names also fails, so a stale exemption cannot be reused quietly.
 *
 * Worker-import rows name the specifiers they permit. Any other banned import
 * in that file still fails. SQL rows name the file and the exact interpolated
 * expression. Adding or swapping an expression fails until this list is updated
 * on purpose. A row whose expression is gone also fails.
 */

export const workerImportAllowlist = [
  {
    "file": "packages/reference/src/admin-store.ts",
    "specifiers": [
      "@vantage/db/admin"
    ],
    "reason": "Worker-only TBA reference writer. Request routes are banned from importing this module; the worker role is what upserts shared reference rows."
  },
  {
    "file": "packages/reference/src/credential-store.ts",
    "specifiers": [
      "@vantage/db/admin"
    ],
    "reason": "Worker-only store for platform TBA credentials, used by the reference production worker. It is not a signed-in request path."
  },
  {
    "file": "packages/reference/src/nexus-ingest.ts",
    "specifiers": [
      "@vantage/db/admin"
    ],
    "reason": "Worker-only Nexus ingest. The request-path ban on @vantage/reference/nexus-ingest is what keeps this import from being pulled in by a page."
  },
  {
    "file": "apps/web/lib/reference/worker-ingest.ts",
    "specifiers": [
      "@vantage/reference/production-worker",
      "@vantage/reference/nexus-ingest"
    ],
    "reason": "Worker-role TBA and Nexus ingest. Imported by the CRON_SECRET tba-sync and reference-refresh routes, and by the platform-admin branch of data-connectors after assertPlatformAdmin and assertPlatformPrivilegeMfa."
  },
  {
    "file": "apps/web/lib/reference/season-cron-piggybacks.ts",
    "specifiers": [
      "@vantage/intel-research/production-worker"
    ],
    "reason": "Season cron piggyback. Hobby allows two Vercel crons, so the research sweep runs from the TBA season sync rather than its own request."
  },
  {
    "file": "apps/web/lib/team-dossier/refresh.ts",
    "specifiers": [
      "@vantage/reference/production-worker"
    ],
    "reason": "Weekly dossier refresh called from the season cron piggyback. The file's own comment says it is worker-only and not a request."
  },
  {
    "file": "apps/web/app/api/cron/research-sweep/route.ts",
    "specifiers": [
      "@vantage/intel-research/production-worker"
    ],
    "reason": "Cron route guarded by CRON_SECRET. It runs the research sweep on the worker pool; there is no signed-in user."
  }
];

/**
 * Signed-in route files that may reach an admin-pool module. The row names the
 * modules, not a blanket exemption. A new import of a different admin module
 * in the same file still fails.
 */
export const signedInAdminImportAllowlist = [
  {
    file: "apps/web/app/api/admin/data-connectors/route.ts",
    modules: ["apps/web/lib/reference/worker-ingest.ts"],
    reason: "Platform-admin sync loads worker-ingest only after assertPlatformAdmin and assertPlatformPrivilegeMfa when orgId is null. A team org sync dispatches the reference cron and does not call the worker.",
  },
  {
    file: "apps/web/app/api/organizations/claim/route.ts",
    modules: ["apps/web/lib/provisioning/pool.ts"],
    reason: "After the session and withRls claim, startTeamProvisioning loads the workflow that holds session advisory locks on the worker pool. vantage_app is not granted those job writes. The route does not query through the pool itself.",
  },
  {
    file: "apps/web/app/api/organizations/provisioning/route.ts",
    modules: ["apps/web/lib/provisioning/pool.ts"],
    reason: "Retry of team setup, after the session check, starts the same provisioning workflow. The status read is withRls. The pool is the workflow's worker connection, which vantage_app cannot replace without a new grant.",
  },
  {
    file: "apps/web/app/.well-known/workflow/v1/step/route.js",
    modules: ["apps/web/lib/provisioning/pool.ts"],
    reason: "Generated Vercel Workflow step endpoint. It runs worker steps for provisioning and the sheets hub. It is not a signed-in session, and the pool import is bundled because those workflows close over it.",
  },
];

export const requestPoolAllowlist = [
  {
    "file": "apps/web/app/api/calendar/feed/[token]/route.ts",
    "calls": 1,
    "reason": "Public calendar feed. The token is the credential; the route calls a parameterized lookup on requestPool because there is no signed-in user to pass to withRls."
  },
  {
    "file": "apps/web/app/api/drive-share/[token]/download/route.ts",
    "calls": 2,
    "reason": "Public drive-share download. The share token is the credential; both reads go through requestPool and parameterized SQL, not a session withRls transaction."
  },
  {
    "file": "apps/web/app/api/drive-share/[token]/route.ts",
    "calls": 2,
    "reason": "Public drive-share preview. Same token gate as the download route: requestPool, no signed-in user."
  },
  {
    "file": "apps/web/app/api/integrations/slack/events/route.ts",
    "calls": 2,
    "reason": "Slack webhook. Signature verification and ingest run without a Vantage session, so the route uses requestPool instead of withRls."
  },
  {
    "file": "apps/web/app/api/invites/preview/route.ts",
    "calls": 2,
    "reason": "Invite preview before the person has a session. Token peek uses requestPool; the signed-in branch of this route still uses withRls."
  },
  {
    "file": "apps/web/app/api/notifications/unsubscribe/route.ts",
    "calls": 1,
    "reason": "One-click email unsubscribe. The token is the credential; applyUnsubscribeByToken runs on a requestPool client because there is no session."
  },
  {
    "file": "apps/web/app/api/parent-view/[token]/route.ts",
    "calls": 1,
    "reason": "Parent view link. The token selects the row through a parameterized requestPool query; there is no member session."
  },
  {
    "file": "apps/web/app/api/parents/unsubscribe/[token]/route.ts",
    "calls": 1,
    "reason": "Parent email unsubscribe. Token-gated requestPool query, no signed-in user."
  },
  {
    "file": "apps/web/app/api/partner-assets/[publicId]/route.ts",
    "calls": 1,
    "reason": "Public partner asset bytes. Unguessable public id, parameterized requestPool read, no session."
  },
  {
    "file": "apps/web/app/api/partner-placements/route.ts",
    "calls": 1,
    "reason": "Public placement lookup via get_public_partner_placements. No session, so the route cannot open withRls."
  },
  {
    "file": "apps/web/app/api/public-forms/[token]/route.ts",
    "calls": 4,
    "reason": "Public form read and submit. The share token is the credential; SECURITY DEFINER helpers run on requestPool, which is the app role and not dbAdmin."
  },
  {
    "file": "apps/web/app/api/sponsor-wall/[publicId]/route.ts",
    "calls": 1,
    "reason": "Published sponsor wall. Public id, read-only requestPool query, no session."
  },
  {
    "file": "apps/web/app/api/support/[publicId]/route.ts",
    "calls": 2,
    "reason": "Public partner storefront and submission. Dedicated functions on requestPool; no signed-in user."
  },
  {
    "file": "apps/web/app/api/teams/join/route.ts",
    "calls": 3,
    "reason": "Join-by-code and invite peek run before a membership exists, so those statements use requestPool. The signed-in membership read in this file still uses withRls."
  },
  {
    "file": "apps/web/lib/reference/notify-schedule.ts",
    "calls": 1,
    "reason": "TBA cron follow-up. emit_match_schedule_alerts runs after the worker sync, with event keys and no user id, so it uses requestPool rather than withRls."
  }
];

export const sqlFragmentAllowlist = [
  {
    "file": "apps/web/app/api/account/route.ts",
    "expression": "LIVE_NOTIFICATION_SQL",
    "reason": "Internal constant or fragment helper (LIVE_NOTIFICATION_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/admin/audit/route.ts",
    "expression": "LIMIT",
    "reason": "Internal constant or fragment helper (LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/admin/sponsored/route.ts",
    "expression": "USAGE_LIMIT",
    "reason": "Internal constant or fragment helper (USAGE_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/agent/runs/route.ts",
    "expression": "RUN_LIMIT",
    "reason": "Internal constant or fragment helper (RUN_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/auto-routines/route.ts",
    "expression": "SELECT_COLS",
    "reason": "Internal constant or fragment helper (SELECT_COLS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/awards/items/route.ts",
    "expression": "RETURNING",
    "reason": "Internal constant or fragment helper (RETURNING) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/awards/route.ts",
    "expression": "RETURNING",
    "reason": "Internal constant or fragment helper (RETURNING) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/awards/route.ts",
    "expression": "seasonYear ? \"AND season_year=$2\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (seasonYear ? \"AND season_year=$2\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/batteries/route.ts",
    "expression": "sets.join(\", \")",
    "reason": "SQL fragment chosen from a fixed branch (sets.join(\", \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/batteries/route.ts",
    "expression": "values.length + 1",
    "reason": "Placeholder index from the bound-parameter array (values.length + 1). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/batteries/route.ts",
    "expression": "values.length + 2",
    "reason": "Placeholder index from the bound-parameter array (values.length + 2). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/billing/activity/route.ts",
    "expression": "EVENT_LIMIT",
    "reason": "Internal constant or fragment helper (EVENT_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/billing/activity/route.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/billing/activity/route.ts",
    "expression": "teamUsageSql(\"a\")",
    "reason": "Identifier or SQL fragment (teamUsageSql(\"a\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/billing/budgets/route.ts",
    "expression": "config[0]",
    "reason": "Identifier or SQL fragment (config[0]) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/billing/budgets/route.ts",
    "expression": "config[1]",
    "reason": "Identifier or SQL fragment (config[1]) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/billing/budgets/route.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/billing/budgets/route.ts",
    "expression": "where",
    "reason": "Identifier or SQL fragment (where) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/billing/denials/route.ts",
    "expression": "EVENT_LIMIT",
    "reason": "Internal constant or fragment helper (EVENT_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/billing/usage/route.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/billing/usage/route.ts",
    "expression": "teamUsageSql(\"a\")",
    "reason": "Identifier or SQL fragment (teamUsageSql(\"a\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/calendar/route.ts",
    "expression": "columns",
    "reason": "Identifier or SQL fragment (columns) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/calendar/route.ts",
    "expression": "joins",
    "reason": "Identifier or SQL fragment (joins) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/calendar/route.ts",
    "expression": "sets.join(\", \")",
    "reason": "SQL fragment chosen from a fixed branch (sets.join(\", \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/finance/categories/route.ts",
    "expression": "seasonYear ? \"AND season_year=$2\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (seasonYear ? \"AND season_year=$2\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/finance/purchase-requests/route.ts",
    "expression": "conditions.join(\" AND \")",
    "reason": "SQL fragment chosen from a fixed branch (conditions.join(\" AND \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/finance/purchase-requests/route.ts",
    "expression": "LIST_FIELDS",
    "reason": "Internal constant or fragment helper (LIST_FIELDS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/grants/applications/route.ts",
    "expression": "LIST_FIELDS",
    "reason": "Internal constant or fragment helper (LIST_FIELDS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/grants/applications/route.ts",
    "expression": "seasonYear ? \"AND ga.season_year=$2\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (seasonYear ? \"AND ga.season_year=$2\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/grants/items/route.ts",
    "expression": "RETURNING",
    "reason": "Internal constant or fragment helper (RETURNING) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/grants/opportunities/route.ts",
    "expression": "RETURNING",
    "reason": "Internal constant or fragment helper (RETURNING) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/inventory/route.ts",
    "expression": "clause",
    "reason": "Identifier or SQL fragment (clause) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/inventory/route.ts",
    "expression": "values.length + 1",
    "reason": "Placeholder index from the bound-parameter array (values.length + 1). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/inventory/route.ts",
    "expression": "values.length + 2",
    "reason": "Placeholder index from the bound-parameter array (values.length + 2). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/kickoff/route.ts",
    "expression": "clause",
    "reason": "Identifier or SQL fragment (clause) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/kickoff/route.ts",
    "expression": "values.length + 1",
    "reason": "Placeholder index from the bound-parameter array (values.length + 1). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/kickoff/route.ts",
    "expression": "values.length + 2",
    "reason": "Placeholder index from the bound-parameter array (values.length + 2). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/match-debrief/route.ts",
    "expression": "SELECT_COLS",
    "reason": "Internal constant or fragment helper (SELECT_COLS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/messages/export/route.ts",
    "expression": "MAX_EXPORT_ROWS",
    "reason": "Internal constant or fragment helper (MAX_EXPORT_ROWS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/messages/route.ts",
    "expression": "archivedFilter",
    "reason": "Identifier or SQL fragment (archivedFilter) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/messages/route.ts",
    "expression": "archivedSelect",
    "reason": "Identifier or SQL fragment (archivedSelect) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/messages/route.ts",
    "expression": "HISTORY_PAGE_SIZE + 1",
    "reason": "Identifier or SQL fragment (HISTORY_PAGE_SIZE + 1) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/messages/route.ts",
    "expression": "peersCte",
    "reason": "Identifier or SQL fragment (peersCte) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/messages/route.ts",
    "expression": "POLL_LIMIT",
    "reason": "Internal constant or fragment helper (POLL_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/notebook/route.ts",
    "expression": "sets.join(\", \")",
    "reason": "SQL fragment chosen from a fixed branch (sets.join(\", \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/notebook/route.ts",
    "expression": "values.length + 1",
    "reason": "Placeholder index from the bound-parameter array (values.length + 1). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/notebook/route.ts",
    "expression": "values.length + 2",
    "reason": "Placeholder index from the bound-parameter array (values.length + 2). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/organizations/ai-keys/route.ts",
    "expression": "KEY_ROW_COLUMNS",
    "reason": "Internal constant or fragment helper (KEY_ROW_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/organizations/ai-keys/route.ts",
    "expression": "table",
    "reason": "Identifier or SQL fragment (table) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/organizations/ai-policy/route.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/organizations/ai-usage/route.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/organizations/audit/route.ts",
    "expression": "EVENT_LIMIT",
    "reason": "Internal constant or fragment helper (EVENT_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/organizations/export-audit/route.ts",
    "expression": "LIMIT",
    "reason": "Internal constant or fragment helper (LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/outreach/route.ts",
    "expression": "conditions.join(\" AND \")",
    "reason": "SQL fragment chosen from a fixed branch (conditions.join(\" AND \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/outreach/route.ts",
    "expression": "RETURNING",
    "reason": "Internal constant or fragment helper (RETURNING) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/practice/route.ts",
    "expression": "clause",
    "reason": "Identifier or SQL fragment (clause) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/practice/route.ts",
    "expression": "values.length + 1",
    "reason": "Placeholder index from the bound-parameter array (values.length + 1). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/practice/route.ts",
    "expression": "values.length + 2",
    "reason": "Placeholder index from the bound-parameter array (values.length + 2). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/robot/route.ts",
    "expression": "clause",
    "reason": "Identifier or SQL fragment (clause) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/robot/route.ts",
    "expression": "values.length + 1",
    "reason": "Placeholder index from the bound-parameter array (values.length + 1). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/robot/route.ts",
    "expression": "values.length + 2",
    "reason": "Placeholder index from the bound-parameter array (values.length + 2). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/scouting/form-responses/route.ts",
    "expression": "responses",
    "reason": "Identifier or SQL fragment (responses) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/scouting/form-responses/route.ts",
    "expression": "schema.type === \"pit\" ? \"'Pit'::text\" : \"match_key\"",
    "reason": "SQL fragment chosen from a fixed branch (schema.type === \"pit\" ? \"'Pit'::text\" : \"match_key\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/scouting/form-responses/route.ts",
    "expression": "table",
    "reason": "Identifier or SQL fragment (table) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/sponsors/contributions/route.ts",
    "expression": "conditions.join(\" AND \")",
    "reason": "SQL fragment chosen from a fixed branch (conditions.join(\" AND \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/sponsors/contributions/route.ts",
    "expression": "RETURNING",
    "reason": "Internal constant or fragment helper (RETURNING) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/sponsors/prospects/route.ts",
    "expression": "status ? \"AND status=$2\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (status ? \"AND status=$2\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/sponsors/route.ts",
    "expression": "status ? \"AND s.status=$2\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (status ? \"AND s.status=$2\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/subsystems/route.ts",
    "expression": "SELECT_COLS",
    "reason": "Internal constant or fragment helper (SELECT_COLS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/team/calendar/route.ts",
    "expression": "BASE_EVENT_COLUMNS",
    "reason": "Internal constant or fragment helper (BASE_EVENT_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/team/calendar/route.ts",
    "expression": "EVENT_JOINS",
    "reason": "Internal constant or fragment helper (EVENT_JOINS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/team/calendar/route.ts",
    "expression": "sets.join(\", \")",
    "reason": "SQL fragment chosen from a fixed branch (sets.join(\", \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/team/knowledge-history/route.ts",
    "expression": "LIMIT",
    "reason": "Internal constant or fragment helper (LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/team/roster/route.ts",
    "expression": "ROLE_ORDER",
    "reason": "Internal constant or fragment helper (ROLE_ORDER) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/app/api/video/route.ts",
    "expression": "sets.join(\", \")",
    "reason": "SQL fragment chosen from a fixed branch (sets.join(\", \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/app/api/whiteboard/route.ts",
    "expression": "clause",
    "reason": "Identifier or SQL fragment (clause) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/app/api/whiteboard/route.ts",
    "expression": "values.length + 1",
    "reason": "Placeholder index from the bound-parameter array (values.length + 1). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/app/api/whiteboard/route.ts",
    "expression": "values.length + 2",
    "reason": "Placeholder index from the bound-parameter array (values.length + 2). The values are already parameters; the $n token itself cannot be bound."
  },
  {
    "file": "apps/web/lib/agent-config/store.ts",
    "expression": "columns",
    "reason": "Identifier or SQL fragment (columns) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/agent-config/store.ts",
    "expression": "LEGACY_ITEM_COLUMNS",
    "reason": "Internal constant or fragment helper (LEGACY_ITEM_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/agent-config/store.ts",
    "expression": "SAVE_COLUMNS",
    "reason": "Internal constant or fragment helper (SAVE_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/ai/capabilities.ts",
    "expression": "savepoint",
    "reason": "SAVEPOINT identifier (savepoint). Postgres does not accept a bind parameter in SAVEPOINT, so the name is an internal token."
  },
  {
    "file": "apps/web/lib/alliance-selection-desk/compute-alliance-selection-desk.ts",
    "expression": "parts.join(\", \")",
    "reason": "SQL fragment chosen from a fixed branch (parts.join(\", \")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/assembly-manual/cots.ts",
    "expression": "skuColumn",
    "reason": "Identifier or SQL fragment (skuColumn) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/assembly-manual/store.ts",
    "expression": "RUN_COLUMNS",
    "reason": "Internal constant or fragment helper (RUN_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/briefing/compute-briefing.ts",
    "expression": "RECENT_SESSION_LIMIT",
    "reason": "Internal constant or fragment helper (RECENT_SESSION_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/business/compute-season-finance.ts",
    "expression": "spentExpression",
    "reason": "Identifier or SQL fragment (spentExpression) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/cad/agent-mode-session.ts",
    "expression": "MODE_COLUMNS",
    "reason": "Internal constant or fragment helper (MODE_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/chemistry/load-chemistry.ts",
    "expression": "matchStillAheadSql()",
    "reason": "Identifier or SQL fragment (matchStillAheadSql()) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/code/bugbot-store.ts",
    "expression": "tuples.join(\",\")",
    "reason": "SQL fragment chosen from a fixed branch (tuples.join(\",\")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/command/load-command.ts",
    "expression": "matchStillAheadSql()",
    "reason": "Identifier or SQL fragment (matchStillAheadSql()) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/costs/compute-costs.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/dashboard/home-widget-loaders.ts",
    "expression": "ISO.replace(\"%s\", \"a.created_at\")",
    "reason": "SQL fragment chosen from a fixed branch (ISO.replace(\"%s\", \"a.created_at\")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/dashboard/home-widget-loaders.ts",
    "expression": "ISO.replace(\"%s\", \"e.ends_at\")",
    "reason": "SQL fragment chosen from a fixed branch (ISO.replace(\"%s\", \"e.ends_at\")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/dashboard/home-widget-loaders.ts",
    "expression": "ISO.replace(\"%s\", \"e.starts_at\")",
    "reason": "SQL fragment chosen from a fixed branch (ISO.replace(\"%s\", \"e.starts_at\")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/dashboard/home-widget-loaders.ts",
    "expression": "ISO.replace(\"%s\", \"starts_at\")",
    "reason": "SQL fragment chosen from a fixed branch (ISO.replace(\"%s\", \"starts_at\")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/dashboard/home-widget-loaders.ts",
    "expression": "ISO.replace(\"%s\", \"updated_at\")",
    "reason": "SQL fragment chosen from a fixed branch (ISO.replace(\"%s\", \"updated_at\")). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/dashboard/home-widget-loaders.ts",
    "expression": "matchStillAheadSql()",
    "reason": "Identifier or SQL fragment (matchStillAheadSql()) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/dashboard/snapshot.ts",
    "expression": "LIVE_NOTIFICATION_SQL",
    "reason": "Internal constant or fragment helper (LIVE_NOTIFICATION_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/dashboard/snapshot.ts",
    "expression": "matchStillAheadSql(\"m\")",
    "reason": "Identifier or SQL fragment (matchStillAheadSql(\"m\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/dashboard/snapshot.ts",
    "expression": "matchStillAheadSql()",
    "reason": "Identifier or SQL fragment (matchStillAheadSql()) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/dashboard/snapshot.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/display.ts",
    "expression": "matchStillAheadSql(\"fm\")",
    "reason": "Identifier or SQL fragment (matchStillAheadSql(\"fm\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/display.ts",
    "expression": "matchStillAheadSql(\"m\")",
    "reason": "Identifier or SQL fragment (matchStillAheadSql(\"m\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/display.ts",
    "expression": "matchStillAheadSql(\"m2\")",
    "reason": "Identifier or SQL fragment (matchStillAheadSql(\"m2\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/dreaming/run-dream.ts",
    "expression": "LIST_LIMIT",
    "reason": "Internal constant or fragment helper (LIST_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/dreaming/run-dream.ts",
    "expression": "MAX_ORGS_PER_RUN",
    "reason": "Internal constant or fragment helper (MAX_ORGS_PER_RUN) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/dreaming/run-dream.ts",
    "expression": "MESSAGE_LIST_LIMIT",
    "reason": "Internal constant or fragment helper (MESSAGE_LIST_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/drive/store.ts",
    "expression": "FILE_COLUMNS",
    "reason": "Internal constant or fragment helper (FILE_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/drive/store.ts",
    "expression": "SHARE_COLUMNS",
    "reason": "Internal constant or fragment helper (SHARE_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/duties/service.ts",
    "expression": "contact",
    "reason": "Identifier or SQL fragment (contact) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/finance/reimbursements.ts",
    "expression": "SUMMARY_COLUMNS",
    "reason": "Internal constant or fragment helper (SUMMARY_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/forms/store.ts",
    "expression": "comparison",
    "reason": "Identifier or SQL fragment (comparison) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/forms/store.ts",
    "expression": "order",
    "reason": "Identifier or SQL fragment (order) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/github/pr-review-run.ts",
    "expression": "PR_REVIEW_COLUMNS",
    "reason": "Internal constant or fragment helper (PR_REVIEW_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/grant-report/allocate.ts",
    "expression": "GRANT_ALLOCATION_RETURNING",
    "reason": "Internal constant or fragment helper (GRANT_ALLOCATION_RETURNING) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/grant-report/allocate.ts",
    "expression": "GRANT_FINANCE_ALLOCATIONS_TABLE",
    "reason": "Internal constant or fragment helper (GRANT_FINANCE_ALLOCATIONS_TABLE) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/grant-report/compute-grant-report.ts",
    "expression": "GRANT_FINANCE_ALLOCATIONS_TABLE",
    "reason": "Internal constant or fragment helper (GRANT_FINANCE_ALLOCATIONS_TABLE) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/library/compute-library.ts",
    "expression": "idColumn",
    "reason": "Identifier or SQL fragment (idColumn) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/library/compute-library.ts",
    "expression": "table",
    "reason": "Identifier or SQL fragment (table) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/marketing/waitlist.ts",
    "expression": "WAITLIST_RETURNING",
    "reason": "Internal constant or fragment helper (WAITLIST_RETURNING) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/match-checklist/compute-match-checklist.ts",
    "expression": "matchStillAheadSql()",
    "reason": "Identifier or SQL fragment (matchStillAheadSql()) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/match-strategy-cards/compute-match-strategy-cards.ts",
    "expression": "matchStillAheadSql(\"m\")",
    "reason": "Identifier or SQL fragment (matchStillAheadSql(\"m\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/matches/match-ahead-sql.ts",
    "expression": "a",
    "reason": "Identifier or SQL fragment (a) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/matches/no-next-match.ts",
    "expression": "OVER",
    "reason": "Internal constant or fragment helper (OVER) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/member-onboarding/run-member-onboarding.ts",
    "expression": "MAX_ITEMS_LISTED",
    "reason": "Internal constant or fragment helper (MAX_ITEMS_LISTED) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/member-onboarding/run-member-onboarding.ts",
    "expression": "MAX_MEMBERS_PER_RUN",
    "reason": "Internal constant or fragment helper (MAX_MEMBERS_PER_RUN) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/messages/channels.ts",
    "expression": "archivedFilter",
    "reason": "Identifier or SQL fragment (archivedFilter) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/messages/channels.ts",
    "expression": "archivedSelect",
    "reason": "Identifier or SQL fragment (archivedSelect) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/messages/channels.ts",
    "expression": "archiveSupported ? \"archived_at::text\" : \"NULL::text\"",
    "reason": "SQL fragment chosen from a fixed branch (archiveSupported ? \"archived_at::text\" : \"NULL::text\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/microsoft/run-import.ts",
    "expression": "ISO",
    "reason": "Internal constant or fragment helper (ISO) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ALLIANCE(\"blue\")",
    "reason": "Internal constant or fragment helper (ALLIANCE(\"blue\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ALLIANCE(\"red\")",
    "reason": "Internal constant or fragment helper (ALLIANCE(\"red\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"b.updated_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"b.updated_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"COALESCE(h.clock_out, h.created_at)\")",
    "reason": "Internal constant or fragment helper (ISO(\"COALESCE(h.clock_out, h.created_at)\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"COALESCE(o.synced_at, e.synced_at)\")",
    "reason": "Internal constant or fragment helper (ISO(\"COALESCE(o.synced_at, e.synced_at)\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"created_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"created_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"e.ends_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"e.ends_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"e.starts_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"e.starts_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"e.updated_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"e.updated_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"f.created_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"f.created_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"f.occurred_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"f.occurred_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"h.clock_in\")",
    "reason": "Internal constant or fragment helper (ISO(\"h.clock_in\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"h.clock_out\")",
    "reason": "Internal constant or fragment helper (ISO(\"h.clock_out\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"l.published_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"l.published_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"l.updated_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"l.updated_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"m.created_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"m.created_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"observed_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"observed_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"r.actual_time\")",
    "reason": "Internal constant or fragment helper (ISO(\"r.actual_time\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"r.event_time\")",
    "reason": "Internal constant or fragment helper (ISO(\"r.event_time\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"r.synced_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"r.synced_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"s.created_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"s.created_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"s.updated_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"s.updated_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"t.completed_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"t.completed_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"t.created_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"t.created_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ISO(\"t.updated_at\")",
    "reason": "Internal constant or fragment helper (ISO(\"t.updated_at\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "ROLE_LABEL",
    "reason": "Internal constant or fragment helper (ROLE_LABEL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "SCORE(\"blue\")",
    "reason": "Internal constant or fragment helper (SCORE(\"blue\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "SCORE(\"red\")",
    "reason": "Internal constant or fragment helper (SCORE(\"red\")) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "expression": "US",
    "reason": "Internal constant or fragment helper (US) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/microsoft/workbook-sync.ts",
    "expression": "iso(\"actual_time\")",
    "reason": "Identifier or SQL fragment (iso(\"actual_time\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/microsoft/workbook-sync.ts",
    "expression": "iso(\"COALESCE(m.synced_at, t.synced_at)\")",
    "reason": "Identifier or SQL fragment (iso(\"COALESCE(m.synced_at, t.synced_at)\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/microsoft/workbook-sync.ts",
    "expression": "iso(\"event_time\")",
    "reason": "Identifier or SQL fragment (iso(\"event_time\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/microsoft/workbook-sync.ts",
    "expression": "iso(\"synced_at\")",
    "reason": "Identifier or SQL fragment (iso(\"synced_at\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/microsoft/workbook-sync.ts",
    "expression": "MAX_ROWS_PER_TABLE + 1",
    "reason": "Identifier or SQL fragment (MAX_ROWS_PER_TABLE + 1) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/microsoft/workbook-sync.ts",
    "expression": "scoutColumns",
    "reason": "Identifier or SQL fragment (scoutColumns) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/mirror/mirror-import.ts",
    "expression": "CONNECTION_TABLE[copy]",
    "reason": "Identifier or SQL fragment (CONNECTION_TABLE[copy]) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/mirror/mirror-sync.ts",
    "expression": "table",
    "reason": "Identifier or SQL fragment (table) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "expression": "name",
    "reason": "SAVEPOINT identifier (name). Postgres does not accept a bind parameter in SAVEPOINT, so the name is an internal token."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "expression": "present.has(\"team_subteams\") ? \"LEFT JOIN team_subteams s ON s.id = t.subteam_id\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (present.has(\"team_subteams\") ? \"LEFT JOIN team_subteams s ON s.id = t.subteam_id\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "expression": "present.has(\"team_subteams\") ? \"s.name\" : \"NULL::text\"",
    "reason": "SQL fragment chosen from a fixed branch (present.has(\"team_subteams\") ? \"s.name\" : \"NULL::text\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "expression": "withChecks ? `(SELECT count(*)::int FROM member_onboarding_checks c WHERE c.org_id = t.org_id AND c.user_id = t.user_id AND c.track_key = t.track_key)` : \"0\"",
    "reason": "SQL fragment chosen from a fixed branch (withChecks ? `(SELECT count(*)::int FROM member_onboarding_checks c WHERE c.org_id = t.org_id AND c.user_id = t.user_id AND c.track_key = t.track_key)` : \"0\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "expression": "withNames ? \"LEFT JOIN team_subteams s ON s.id = e.subteam_id\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (withNames ? \"LEFT JOIN team_subteams s ON s.id = e.subteam_id\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "expression": "withNames ? \"s.name\" : \"NULL::text\"",
    "reason": "SQL fragment chosen from a fixed branch (withNames ? \"s.name\" : \"NULL::text\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "expression": "withRsvp ? \"LEFT JOIN subteam_calendar_rsvps r ON r.event_id = e.id AND r.user_id = $2::uuid\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (withRsvp ? \"LEFT JOIN subteam_calendar_rsvps r ON r.event_id = e.id AND r.user_id = $2::uuid\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "expression": "withRsvp ? \"r.response\" : \"NULL::text\"",
    "reason": "SQL fragment chosen from a fixed branch (withRsvp ? \"r.response\" : \"NULL::text\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/notifications/inbox-store.ts",
    "expression": "action === \"unread\" ? \"NULL\" : \"coalesce(read_at, now())\"",
    "reason": "SQL fragment chosen from a fixed branch (action === \"unread\" ? \"NULL\" : \"coalesce(read_at, now())\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/notifications/inbox-store.ts",
    "expression": "INBOX_ACTIVE_ORG_SQL",
    "reason": "Internal constant or fragment helper (INBOX_ACTIVE_ORG_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/notifications/inbox-store.ts",
    "expression": "INBOX_SCOPE_SQL",
    "reason": "Internal constant or fragment helper (INBOX_SCOPE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/notifications/inbox-store.ts",
    "expression": "inboxScopeSql(\"scope.org_id\")",
    "reason": "Identifier or SQL fragment (inboxScopeSql(\"scope.org_id\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/orders/compute-orders.ts",
    "expression": "actualColumn",
    "reason": "Identifier or SQL fragment (actualColumn) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/parent-comms/run-parent-digest.ts",
    "expression": "MAX_ORGS_PER_RUN",
    "reason": "Internal constant or fragment helper (MAX_ORGS_PER_RUN) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/parent-comms/send-digest.ts",
    "expression": "MAX_EVENT_ROWS",
    "reason": "Internal constant or fragment helper (MAX_EVENT_ROWS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/part-requests/compute-part-requests.ts",
    "expression": "REQUEST_FIELDS",
    "reason": "Internal constant or fragment helper (REQUEST_FIELDS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/performance-email/run-performance-email.ts",
    "expression": "MATCH_LIST_LIMIT",
    "reason": "Internal constant or fragment helper (MATCH_LIST_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/performance-email/run-performance-email.ts",
    "expression": "MAX_MEMBERS_PER_ORG",
    "reason": "Internal constant or fragment helper (MAX_MEMBERS_PER_ORG) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/performance-email/run-performance-email.ts",
    "expression": "MAX_ORGS_PER_RUN",
    "reason": "Internal constant or fragment helper (MAX_ORGS_PER_RUN) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/performance-email/run-performance-email.ts",
    "expression": "UPCOMING_LIST_LIMIT",
    "reason": "Internal constant or fragment helper (UPCOMING_LIST_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/picklist-collab/compute-picklist-collab.ts",
    "expression": "observableMatchSql(\"m\")",
    "reason": "Identifier or SQL fragment (observableMatchSql(\"m\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/picklist/store.ts",
    "expression": "LIST_COLUMNS",
    "reason": "Internal constant or fragment helper (LIST_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/pit/load-board.ts",
    "expression": "matchStillAheadSql()",
    "reason": "Identifier or SQL fragment (matchStillAheadSql()) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/scout-coverage-live/compute-scout-coverage-live.ts",
    "expression": "REVIEWED_FLAG_HISTORY_LIMIT",
    "reason": "Internal constant or fragment helper (REVIEWED_FLAG_HISTORY_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/scouting/coverage.ts",
    "expression": "COVERAGE_MATCH_LIMIT",
    "reason": "Internal constant or fragment helper (COVERAGE_MATCH_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/scouting/coverage.ts",
    "expression": "observableMatchSql(\"matches_ref\")",
    "reason": "Identifier or SQL fragment (observableMatchSql(\"matches_ref\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/scouting/lead-summary-load.ts",
    "expression": "NAME",
    "reason": "Internal constant or fragment helper (NAME) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/scouting/scouted-counts.ts",
    "expression": "observableMatchSql(\"m\")",
    "reason": "Identifier or SQL fragment (observableMatchSql(\"m\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/scouting/sync-guards.ts",
    "expression": "matchKey",
    "reason": "Identifier or SQL fragment (matchKey) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/scouting/sync-guards.ts",
    "expression": "table",
    "reason": "Identifier or SQL fragment (table) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/scouting/sync-guards.ts",
    "expression": "where",
    "reason": "Identifier or SQL fragment (where) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/scouting/team-profiles.ts",
    "expression": "observableMatchSql(\"m\")",
    "reason": "Identifier or SQL fragment (observableMatchSql(\"m\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/shift-balancer/compute-shift-balancer.ts",
    "expression": "matchStillAheadSql()",
    "reason": "Identifier or SQL fragment (matchStillAheadSql()) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/strategy/compute-strategy.ts",
    "expression": "matchStillAheadSql(\"m\")",
    "reason": "Identifier or SQL fragment (matchStillAheadSql(\"m\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "iso(\"b.created_at\")",
    "reason": "Identifier or SQL fragment (iso(\"b.created_at\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "iso(\"created_at\")",
    "reason": "Identifier or SQL fragment (iso(\"created_at\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "iso(\"l.published_at\")",
    "reason": "Identifier or SQL fragment (iso(\"l.published_at\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "iso(\"l.updated_at\")",
    "reason": "Identifier or SQL fragment (iso(\"l.updated_at\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "iso(\"r.saved_at\")",
    "reason": "Identifier or SQL fragment (iso(\"r.saved_at\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "iso(\"updated_at\")",
    "reason": "Identifier or SQL fragment (iso(\"updated_at\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "LESSON_COLUMNS",
    "reason": "Internal constant or fragment helper (LESSON_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "LESSON_JOINS",
    "reason": "Internal constant or fragment helper (LESSON_JOINS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "LIST_LIMIT",
    "reason": "Internal constant or fragment helper (LIST_LIMIT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "lock ? \"FOR UPDATE OF l\" : \"\"",
    "reason": "SQL fragment chosen from a fixed branch (lock ? \"FOR UPDATE OF l\" : \"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "expression": "REVISIONS_KEPT",
    "reason": "Internal constant or fragment helper (REVISIONS_KEPT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/agent/src/action-proposals.ts",
    "expression": "PROPOSAL_COLUMNS",
    "reason": "Internal constant or fragment helper (PROPOSAL_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/agent/src/orchestrator.ts",
    "expression": "name",
    "reason": "SAVEPOINT identifier (name). Postgres does not accept a bind parameter in SAVEPOINT, so the name is an internal token."
  },
  {
    "file": "packages/agent/src/resolve-chat-adapter.ts",
    "expression": "KEY_ENABLED_SQL",
    "reason": "Internal constant or fragment helper (KEY_ENABLED_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/agent/src/resolve-chat-adapter.ts",
    "expression": "KEY_PRIORITY_SQL",
    "reason": "Internal constant or fragment helper (KEY_PRIORITY_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/agent/src/resolve-chat-adapter.ts",
    "expression": "KEY_UNDER_LIMIT_SQL",
    "reason": "Internal constant or fragment helper (KEY_UNDER_LIMIT_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/agent/src/tinyfish-keys.ts",
    "expression": "name",
    "reason": "SAVEPOINT identifier (name). Postgres does not accept a bind parameter in SAVEPOINT, so the name is an internal token."
  },
  {
    "file": "packages/billing/src/ai-governance.ts",
    "expression": "teamUsageSql(\"a\")",
    "reason": "Identifier or SQL fragment (teamUsageSql(\"a\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "packages/billing/src/allowance.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/billing/src/index.ts",
    "expression": "KEY_UNDER_LIMIT_SQL",
    "reason": "Internal constant or fragment helper (KEY_UNDER_LIMIT_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/billing/src/index.ts",
    "expression": "lockRow?\" FOR UPDATE OF w\":\"\"",
    "reason": "SQL fragment chosen from a fixed branch (lockRow?\" FOR UPDATE OF w\":\"\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "packages/billing/src/index.ts",
    "expression": "TEAM_USAGE_SQL",
    "reason": "Internal constant or fragment helper (TEAM_USAGE_SQL) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/billing/src/index.ts",
    "expression": "teamUsageSql(\"a\")",
    "reason": "Identifier or SQL fragment (teamUsageSql(\"a\")) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "packages/core/src/email-notifications.ts",
    "expression": "PREFS_COLUMNS",
    "reason": "Internal constant or fragment helper (PREFS_COLUMNS) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/core/src/product-releases.ts",
    "expression": "RELEASE_SELECT",
    "reason": "Internal constant or fragment helper (RELEASE_SELECT) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "packages/db/src/index.ts",
    "expression": "pg.escapeLiteral(orgId)",
    "reason": "Session team id escaped with pg.escapeLiteral before it is placed in the transaction prelude. The id is also checked against the UUID alphabet, and a bind parameter cannot sit inside that opening script."
  },
  {
    "file": "packages/db/src/index.ts",
    "expression": "pg.escapeLiteral(userId)",
    "reason": "Session user id escaped with pg.escapeLiteral before it is placed in the transaction prelude. The id is also checked against the UUID alphabet, and a bind parameter cannot sit inside that opening script."
  },
  {
    "file": "packages/db/src/query-waves.ts",
    "expression": "isolate",
    "reason": "SAVEPOINT identifier (isolate). Postgres does not accept a bind parameter in SAVEPOINT, so the name is an internal token."
  },
  {
    "file": "packages/db/src/query-waves.ts",
    "expression": "savepoint",
    "reason": "SAVEPOINT identifier (savepoint). Postgres does not accept a bind parameter in SAVEPOINT, so the name is an internal token."
  },
  {
    "file": "packages/db/src/savepoint.ts",
    "expression": "name",
    "reason": "SAVEPOINT identifier (name). Postgres does not accept a bind parameter in SAVEPOINT, so the name is an internal token."
  },
  {
    "file": "packages/scouting/src/repository.ts",
    "expression": "existing.entryType === \"match\" ? \"match_key\" : \"NULL::text\"",
    "reason": "SQL fragment chosen from a fixed branch (existing.entryType === \"match\" ? \"match_key\" : \"NULL::text\"). The branch is source code, not a request string, and a different expression fails."
  },
  {
    "file": "packages/scouting/src/repository.ts",
    "expression": "table",
    "reason": "Identifier or SQL fragment (table) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "packages/scouting/src/repository.ts",
    "expression": "targetTable",
    "reason": "Identifier or SQL fragment (targetTable) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "scripts/recovery-checkpoint.mjs",
    "expression": "name",
    "reason": "SAVEPOINT identifier (name). Postgres does not accept a bind parameter in SAVEPOINT, so the name is an internal token."
  },
  {
    "file": "scripts/rls-proof-prepare-app-login.mjs",
    "expression": "placeholders",
    "reason": "Identifier or SQL fragment (placeholders) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "scripts/rls-proof-prepare-app-login.mjs",
    "expression": "SET_ROLE",
    "reason": "Internal constant or fragment helper (SET_ROLE) spliced into SQL. It is not a request value. Swapping the expression fails this check."
  },
  {
    "file": "scripts/rls-proof-prepare-app-login.mjs",
    "expression": "template",
    "reason": "Identifier or SQL fragment (template) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "scripts/rls-proof.mjs",
    "expression": "cols",
    "reason": "Identifier or SQL fragment (cols) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "scripts/rls-proof.mjs",
    "expression": "vals",
    "reason": "Identifier or SQL fragment (vals) from a fixed helper or internal constant. Replacing this expression text fails until the allowlist names the new text."
  },
  {
    "file": "scripts/verify-recovery-checkpoint.mjs",
    "expression": "quote(name)",
    "reason": "Identifier passed through quote() (quote(name)). Utility statements have no bind parameter for an identifier, so the quoted name stays in the text."
  },
  {
    "file": "scripts/verify-recovery-checkpoint.mjs",
    "expression": "quote(schema)",
    "reason": "Identifier passed through quote() (quote(schema)). Utility statements have no bind parameter for an identifier, so the quoted name stays in the text."
  },
  {
    "file": "scripts/verify-recovery-checkpoint.mjs",
    "expression": "quote(table)",
    "reason": "Identifier passed through quote() (quote(table)). Utility statements have no bind parameter for an identifier, so the quoted name stays in the text."
  }
];
