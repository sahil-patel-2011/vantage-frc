/**
 * Reviewed exceptions to the tenancy checks in scripts/security-boundaries.mjs.
 *
 * Each entry is a suppression. A new file that imports a worker module, calls
 * requestPool outside withRls, or interpolates a SQL template fails until a
 * row is added here with a reason. An entry whose file no longer does the
 * thing it names also fails, so a stale exemption cannot be reused quietly.
 *
 * Worker-import rows name the specifiers they permit. Any other banned import
 * in that file still fails. SQL rows record how many templates and
 * interpolations were present on main when this check was added; adding
 * another one fails until this list is updated on purpose.
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
    "file": "apps/web/lib/reference/run-ingest.ts",
    "specifiers": [
      "@vantage/reference/production-worker",
      "@vantage/reference/nexus-ingest"
    ],
    "reason": "Lazy worker imports shared by the TBA cron and by signed-in refresh routes (event directory, dossier, on-demand event hydrate, admin data connectors). Splitting those callers off the worker role is not a mechanical edit; they stay listed under Open."
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
  },
  {
    "file": "apps/web/app/api/team/dossier/route.ts",
    "specifiers": [
      "@vantage/reference/production-worker"
    ],
    "reason": "Signed-in dossier build calls the reference worker after a withRls claim. Existing request-path use of the worker role; not rewritten. Listed under Open."
  },
  {
    "file": "apps/web/app/api/context/event/directory/route.ts",
    "specifiers": [
      "@vantage/reference/production-worker"
    ],
    "reason": "Signed-in event-directory refresh calls the reference worker after a withRls capability check. Existing request-path use of the worker role; not rewritten. Listed under Open."
  }
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

export const sqlInterpolationAllowlist = [
  {
    "file": "apps/web/app/api/account/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates LIVE_NOTIFICATION_SQL into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/admin/audit/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/admin/sponsored/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates USAGE_LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/agent/runs/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates RUN_LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/auto-routines/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates SELECT_COLS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/awards/items/route.ts",
    "templates": 3,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates RETURNING into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/awards/route.ts",
    "templates": 3,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates RETURNING, seasonYear ? \"AND season_year=$2\" : \"\" into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/batteries/route.ts",
    "templates": 1,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates sets.join(\", \"), values.length + 1, values.length + 2 into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/billing/activity/route.ts",
    "templates": 4,
    "interpolations": 5,
    "reason": "Existing product SQL interpolates EVENT_LIMIT, TEAM_USAGE_SQL, teamUsageSql(\"a\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/billing/budgets/route.ts",
    "templates": 3,
    "interpolations": 6,
    "reason": "Existing product SQL interpolates TEAM_USAGE_SQL, config[0], config[1], where into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/billing/denials/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates EVENT_LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/billing/usage/route.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates TEAM_USAGE_SQL, teamUsageSql(\"a\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/calendar/route.ts",
    "templates": 3,
    "interpolations": 5,
    "reason": "Existing product SQL interpolates columns, joins, sets.join(\", \") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/finance/categories/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates seasonYear ? \"AND season_year=$2\" : \"\" into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/finance/purchase-requests/route.ts",
    "templates": 1,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates LIST_FIELDS, conditions.join(\" AND \") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/grants/applications/route.ts",
    "templates": 1,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates LIST_FIELDS, seasonYear ? \"AND ga.season_year=$2\" : \"\" into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/grants/items/route.ts",
    "templates": 3,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates RETURNING into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/grants/opportunities/route.ts",
    "templates": 3,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates RETURNING into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/inventory/route.ts",
    "templates": 2,
    "interpolations": 6,
    "reason": "Existing product SQL interpolates clause, values.length + 1, values.length + 2 into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/kickoff/route.ts",
    "templates": 3,
    "interpolations": 9,
    "reason": "Existing product SQL interpolates clause, values.length + 1, values.length + 2 into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/match-debrief/route.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates SELECT_COLS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/messages/export/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates MAX_EXPORT_ROWS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/messages/route.ts",
    "templates": 13,
    "interpolations": 15,
    "reason": "Existing product SQL interpolates HISTORY_PAGE_SIZE + 1, POLL_LIMIT, archivedFilter, archivedSelect, limit and 1 more into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/notebook/route.ts",
    "templates": 1,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates sets.join(\", \"), values.length + 1, values.length + 2 into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/organizations/ai-keys/route.ts",
    "templates": 9,
    "interpolations": 9,
    "reason": "Existing product SQL interpolates KEY_ROW_COLUMNS, table into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/organizations/ai-policy/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates TEAM_USAGE_SQL into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/organizations/ai-usage/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates TEAM_USAGE_SQL into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/organizations/audit/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates EVENT_LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/organizations/export-audit/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/outreach/route.ts",
    "templates": 4,
    "interpolations": 5,
    "reason": "Existing product SQL interpolates RETURNING, conditions.join(\" AND \") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/practice/route.ts",
    "templates": 2,
    "interpolations": 6,
    "reason": "Existing product SQL interpolates clause, values.length + 1, values.length + 2 into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/robot/route.ts",
    "templates": 1,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates clause, values.length + 1, values.length + 2 into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/scouting/form-responses/route.ts",
    "templates": 3,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates responses, schema.type === \"pit\" ? \"'Pit'::text\" : \"match_key\", table into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/sponsors/contributions/route.ts",
    "templates": 3,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates RETURNING, conditions.join(\" AND \") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/sponsors/prospects/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates status ? \"AND status=$2\" : \"\" into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/sponsors/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates status ? \"AND s.status=$2\" : \"\" into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/subsystems/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates SELECT_COLS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/team/calendar/route.ts",
    "templates": 5,
    "interpolations": 10,
    "reason": "Existing product SQL interpolates BASE_EVENT_COLUMNS, EVENT_JOINS, OCCURRENCE_LOOKBACK_DAYS, sets.join(\", \") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/team/knowledge-history/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/team/roster/route.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates ROLE_ORDER into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/video/route.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates sets.join(\", \") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/app/api/whiteboard/route.ts",
    "templates": 1,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates clause, values.length + 1, values.length + 2 into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/agent-config/store.ts",
    "templates": 3,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates LEGACY_ITEM_COLUMNS, SAVE_COLUMNS, columns into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/ai/capabilities.ts",
    "templates": 3,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates savepoint into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/alliance-selection-desk/compute-alliance-selection-desk.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates parts.join(\", \") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/assembly-manual/cots.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates skuColumn into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/assembly-manual/store.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates RUN_COLUMNS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/briefing/compute-briefing.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates RECENT_SESSION_LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/business/compute-season-finance.ts",
    "templates": 1,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates spentExpression into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/cad/agent-mode-session.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates MODE_COLUMNS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/chemistry/load-chemistry.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates matchStillAheadSql() into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/code/bugbot-store.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates tuples.join(\",\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/command/load-command.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates matchStillAheadSql() into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/costs/compute-costs.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates TEAM_USAGE_SQL into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/dashboard/home-widget-loaders.ts",
    "templates": 8,
    "interpolations": 9,
    "reason": "Existing product SQL interpolates ISO.replace(\"%s\", \"a.created_at\"), ISO.replace(\"%s\", \"e.ends_at\"), ISO.replace(\"%s\", \"e.starts_at\"), ISO.replace(\"%s\", \"starts_at\"), ISO.replace(\"%s\", \"updated_at\") and 1 more into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/dashboard/snapshot.ts",
    "templates": 4,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates LIVE_NOTIFICATION_SQL, TEAM_USAGE_SQL, matchStillAheadSql(\"m\"), matchStillAheadSql() into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/display.ts",
    "templates": 2,
    "interpolations": 5,
    "reason": "Existing product SQL interpolates matchStillAheadSql(\"fm\"), matchStillAheadSql(\"m\"), matchStillAheadSql(\"m2\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/dreaming/run-dream.ts",
    "templates": 16,
    "interpolations": 16,
    "reason": "Existing product SQL interpolates LIST_LIMIT, MAX_ORGS_PER_RUN, MESSAGE_LIST_LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/drive/store.ts",
    "templates": 4,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates FILE_COLUMNS, SHARE_COLUMNS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/duties/service.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates contact into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/finance/reimbursements.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates SUMMARY_COLUMNS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/forms/store.ts",
    "templates": 1,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates comparison, order into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/github/pr-review-run.ts",
    "templates": 4,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates PR_REVIEW_COLUMNS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/grant-report/allocate.ts",
    "templates": 3,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates GRANT_ALLOCATION_RETURNING, GRANT_FINANCE_ALLOCATIONS_TABLE into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/grant-report/compute-grant-report.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates GRANT_FINANCE_ALLOCATIONS_TABLE into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/library/compute-library.ts",
    "templates": 2,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates idColumn, table into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/marketing/waitlist.ts",
    "templates": 4,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates WAITLIST_RETURNING into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/match-checklist/compute-match-checklist.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates matchStillAheadSql() into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/match-strategy-cards/compute-match-strategy-cards.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates matchStillAheadSql(\"m\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/matches/match-ahead-sql.ts",
    "templates": 1,
    "interpolations": 8,
    "reason": "Existing product SQL interpolates a into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/matches/no-next-match.ts",
    "templates": 2,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates OVER into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/member-onboarding/run-member-onboarding.ts",
    "templates": 3,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates MAX_ITEMS_LISTED, MAX_MEMBERS_PER_RUN into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/messages/channels.ts",
    "templates": 2,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates archiveSupported ? \"archived_at::text\" : \"NULL::text\", archivedFilter, archivedSelect into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/microsoft/run-import.ts",
    "templates": 2,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates ISO into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/microsoft/team-ops-tables.ts",
    "templates": 12,
    "interpolations": 42,
    "reason": "Existing product SQL interpolates ALLIANCE(\"blue\"), ALLIANCE(\"red\"), ISO(\"COALESCE(h.clock_out, h.created_at)\"), ISO(\"COALESCE(o.synced_at, e.synced_at)\"), ISO(\"b.updated_at\") and 24 more into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/microsoft/workbook-sync.ts",
    "templates": 4,
    "interpolations": 8,
    "reason": "Existing product SQL interpolates MAX_ROWS_PER_TABLE + 1, iso(\"COALESCE(m.synced_at, t.synced_at)\"), iso(\"actual_time\"), iso(\"event_time\"), iso(\"synced_at\") and 1 more into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/mirror/mirror-import.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates CONNECTION_TABLE[copy] into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/mirror/mirror-sync.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates table into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/my-kit/load-my-kit.ts",
    "templates": 7,
    "interpolations": 11,
    "reason": "Existing product SQL interpolates name, present.has(\"team_subteams\") ? \"LEFT JOIN team_subteams s ON s.id = t..., present.has(\"team_subteams\") ? \"s.name\" : \"NULL::text\", withChecks ? `(SELECT count(*)::int FROM member_onboarding_checks c W..., withNames ? \"LEFT JOIN team_subteams s ON s.id = e.subteam_id\" : \"\" and 3 more into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/notifications/inbox-store.ts",
    "templates": 3,
    "interpolations": 5,
    "reason": "Existing product SQL interpolates INBOX_ACTIVE_ORG_SQL, INBOX_SCOPE_SQL, action === \"unread\" ? \"NULL\" : \"coalesce(read_at, now())\", inboxScopeSql(\"scope.org_id\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/orders/compute-orders.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates actualColumn into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/parent-comms/run-parent-digest.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates MAX_ORGS_PER_RUN into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/parent-comms/send-digest.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates MAX_EVENT_ROWS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/part-requests/compute-part-requests.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates REQUEST_FIELDS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/performance-email/run-performance-email.ts",
    "templates": 4,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates MATCH_LIST_LIMIT, MAX_MEMBERS_PER_ORG, MAX_ORGS_PER_RUN, UPCOMING_LIST_LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/picklist-collab/compute-picklist-collab.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates observableMatchSql(\"m\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/picklist/store.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates LIST_COLUMNS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/pit/load-board.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates matchStillAheadSql() into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/scout-coverage-live/compute-scout-coverage-live.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates REVIEWED_FLAG_HISTORY_LIMIT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/scouting/coverage.ts",
    "templates": 1,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates COVERAGE_MATCH_LIMIT, observableMatchSql(\"matches_ref\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/scouting/lead-summary-load.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates NAME into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/scouting/scouted-counts.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates observableMatchSql(\"m\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/scouting/sync-guards.ts",
    "templates": 1,
    "interpolations": 3,
    "reason": "Existing product SQL interpolates matchKey, table, where into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/scouting/team-profiles.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates observableMatchSql(\"m\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/shift-balancer/compute-shift-balancer.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates matchStillAheadSql() into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/strategy/compute-strategy.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates matchStillAheadSql(\"m\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "apps/web/lib/team-lessons/store.ts",
    "templates": 11,
    "interpolations": 17,
    "reason": "Existing product SQL interpolates LESSON_COLUMNS, LESSON_JOINS, LIST_LIMIT, REVISIONS_KEPT, iso(\"b.created_at\") and 6 more into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "packages/agent/src/action-proposals.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates PROPOSAL_COLUMNS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "packages/agent/src/orchestrator.ts",
    "templates": 4,
    "interpolations": 4,
    "reason": "SAVEPOINT name is interpolated (name). Postgres does not accept a bind parameter for a savepoint identifier. The name is generated in-process, not taken from a request."
  },
  {
    "file": "packages/agent/src/resolve-chat-adapter.ts",
    "templates": 3,
    "interpolations": 7,
    "reason": "Existing product SQL interpolates KEY_ENABLED_SQL, KEY_PRIORITY_SQL, KEY_UNDER_LIMIT_SQL into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "packages/agent/src/tinyfish-keys.ts",
    "templates": 4,
    "interpolations": 4,
    "reason": "SAVEPOINT name is interpolated (name). Postgres does not accept a bind parameter for a savepoint identifier. The name is generated in-process, not taken from a request."
  },
  {
    "file": "packages/billing/src/ai-governance.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates teamUsageSql(\"a\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "packages/billing/src/allowance.ts",
    "templates": 1,
    "interpolations": 1,
    "reason": "Existing product SQL interpolates TEAM_USAGE_SQL into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "packages/billing/src/index.ts",
    "templates": 7,
    "interpolations": 8,
    "reason": "Existing product SQL interpolates KEY_UNDER_LIMIT_SQL, TEAM_USAGE_SQL, lockRow?\" FOR UPDATE OF w\":\"\", teamUsageSql(\"a\") into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "packages/core/src/email-notifications.ts",
    "templates": 2,
    "interpolations": 2,
    "reason": "Existing product SQL interpolates PREFS_COLUMNS into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "packages/core/src/product-releases.ts",
    "templates": 7,
    "interpolations": 7,
    "reason": "Existing product SQL interpolates RELEASE_SELECT into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "packages/db/src/savepoint.ts",
    "templates": 4,
    "interpolations": 4,
    "reason": "SAVEPOINT name is interpolated (name). Postgres does not accept a bind parameter for a savepoint identifier. The name is generated in-process, not taken from a request."
  },
  {
    "file": "packages/scouting/src/repository.ts",
    "templates": 3,
    "interpolations": 4,
    "reason": "Existing product SQL interpolates existing.entryType === \"match\" ? \"match_key\" : \"NULL::text\", table, targetTable into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "scripts/create-worker-login.mjs",
    "templates": 1,
    "interpolations": 1,
    "reason": "CREATE ROLE PASSWORD interpolates a generated password because that utility statement does not accept a bind parameter. The value is randomBytes in this operator script, not request input. Not rewritten."
  },
  {
    "file": "scripts/recovery-checkpoint.mjs",
    "templates": 1,
    "interpolations": 1,
    "reason": "Operator script interpolates name into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "scripts/rls-proof-prepare-app-login.mjs",
    "templates": 2,
    "interpolations": 3,
    "reason": "Operator script interpolates SET_ROLE, placeholders, template into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "scripts/rls-proof.mjs",
    "templates": 3,
    "interpolations": 6,
    "reason": "Operator script interpolates cols, vals into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  },
  {
    "file": "scripts/verify-recovery-checkpoint.mjs",
    "templates": 2,
    "interpolations": 3,
    "reason": "Operator script interpolates quote(name), quote(schema), quote(table) into a SQL template. Data values stay in $n placeholders; the fragment was not rewritten."
  }
];
