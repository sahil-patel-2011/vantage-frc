# Who can change what

For team owners deciding what access to give someone, and for contributors adding a table or a
write route. Money has its own, stricter rule: see [FINANCE_SECURITY.md](FINANCE_SECURITY.md).

## The four roles

Team admin › Access offers three roles; the person who created the team is its **owner**.

| Role (in the app) | `org_role` | In one line |
| --- | --- | --- |
| Owner | `owner` | Everything, including who manages money and handing the team over. |
| Team admin | `admin` | Invites and removes people, changes team settings and AI keys, uses every team tool. |
| Team member | `scout` | Scouts and uses team tools. |
| View only | `viewer` | **Can look, can't change.** |

Owners and admins can also narrow which hubs and tabs a team member or viewer opens
(Team › Security, `membership_hub_access`). That hides pages; it does not change what the
database lets a role write.

## Role × action

| Action | Owner | Team admin | Team member | View only |
| --- | --- | --- | --- | --- |
| Read team data (scouting, strategy, tasks, calendar, chat, CAD, inventory, notebook…) | yes | yes | yes | **yes** |
| Change team data (scout a pit or match, add/edit tasks and todos, calendar events and RSVPs, CAD, inventory, notebook, votes, hours…) | yes | yes | yes (own rows where a feature says so) | **no** |
| Post in team chat, start a DM, pin, link | yes | yes | yes | **no** — reads chat |
| Report a chat message to admins | yes | yes | yes | **yes** |
| Invite, remove, change roles, team settings | yes | yes | no | no |
| Change money | yes | if the owner chose them | if the owner chose them | **no** ([details](FINANCE_SECURITY.md)) |
| Ask for things (purchase/part requests, own reimbursement) | yes | yes | yes | **no** |
| Own state: settings, dashboard layout, tour, notifications read/dismiss, push and calendar-feed subscriptions, own devices, onboarding progress, answers to a form sent to them, Terms/Privacy acceptance | yes | yes | yes | **yes** |
| Ask AI and the research agent (private threads, metered on the team's AI budget) | yes | yes | yes | **yes** — private only, never shared to the team |
| AI proposals ("Confirm to create…") | yes | yes | yes | **no** |

Leaving a team is not self-service for any role today: an owner or admin removes the person
(Team admin › a person › Remove). The View only rule deliberately leaves a person's own
membership DELETE alone, so a future "Leave team" works for viewers too.

## How it is enforced

**In Postgres, not in the page.** Migration `0715_view_only_read_only.sql`:

- `is_org_viewer(org_id)` — true when the current app user's membership in that org is `viewer`
  (`SECURITY DEFINER`, `search_path` pinned, EXECUTE for `vantage_app`/`vantage_worker`).
- Three **restrictive** policies on every org-scoped table (RLS on, an `org_id` column) —
  `view_only_no_insert`, `view_only_no_update`, `view_only_no_delete` — `TO vantage_app` only.
  Restrictive policies AND with the permissive ones, so nothing refused before becomes allowed,
  and owners, admins and team members are untouched.
- The policies call `refuse_view_only_write(org_id)`, which raises SQLSTATE 42501 with detail
  `vantage:view_only` and the sentence *"View only — you can look but not change this. Ask a team
  owner or admin for Team member access."* instead of quietly matching zero rows. UPDATE checks
  the new row (`WITH CHECK`) and keeps `USING (true)`, because an UPDATE policy's `USING` also
  filters `SELECT … FOR UPDATE`, which read paths use.
- `vantage_worker` jobs, `SECURITY DEFINER` functions (accepting an invite, recovery capture) and
  the service roles (`vantage_auth`, `vantage_billing`, `vantage_pairing`…) are not affected.

**The exceptions are a person's own state**, listed with a reason in `view_only_exempt_tables`
(44 tables): own settings and devices (`dashboards` personal layouts, `learning_mode_prefs`,
`cad_user_preferences`, `scout_voice_user_prefs`, `member_llm_keys`, `cad_connections`,
`cad_relay_devices`, `editor_devices`, `ai_bridge_devices`, `calendar_feed_tokens`,
`push_subscriptions`, `grant_calendar_watchlist`, `cad_change_radar_subscriptions`), inbox and
read receipts (`notifications`, `announcement_acks`), onboarding and practice progress
(`member_onboarding_tracks`, `member_onboarding_checks`, `cad_learn_progress`,
`cad_learn_submissions`, `learning_predictions`, `judge_practice_sessions`), their security and
audit trail (`mfa_step_up_sessions`, `auth_policy_audit_events`, `membership_audit_events`,
`export_audit_events`), feedback to Vantage (`bug_reports`, `support_tickets`, `beta_enrollments`,
`product_events`), safety and consent (`org_message_reports`,
`hours_self_view_biometric_consents`), answers to a form sent to them (`form_responses`,
`form_answers`) and their own Ask AI runs (`agent_threads`, `agent_messages`,
`agent_context_usage`, `ai_runs`, `ai_run_steps`, `ai_run_approvals`, `ai_usage_events`,
`api_usage_denials`, `autonomous_agent_runs`, `autonomous_agent_steps`), plus `memberships`, so
leaving the team (deleting their own row) is never blocked by this rule. Three of those keep a
narrower rule: a viewer never inserts or updates a membership (their own role included), their
Ask AI threads stay `private`, and their AI messages are never `explicitly_shared`. Personal tables without an `org_id` (`profiles` — settings, tour, Terms
acceptance — `user_email_preferences`, `org_conversation_participants` — chat read position) are
not org-scoped and are not touched.

**Team chat decision:** a viewer reads chat; posting, starting conversations, pinning and linking
are team-data writes and are refused (no help article promised otherwise). Reporting a message
stays open for youth protection.

**The API says why.** `withRls()` turns the refusal — or a generic RLS refusal when the person is
View only — into `ViewOnlyError` after rollback (`packages/db/src/view-only.ts`).
`publicErrorMessage` passes its sentence through, and the shared responders
(`tenantErrorResponse`, `scoutingErrorResponse`, `securityErrorResponse`, `failMeteredAi`,
`driveErrorResponse`) and the busiest write routes (tasks, todos, calendar, inventory, notebook,
pit, chat, scouting sync) answer `403 { error, reason: "view_only" }`. Routes with their own catch
show the same sentence with their usual status.

**The page says so first.** Viewers see a calm **View only** chip in the top bar, and the obvious
writes on the busiest pages are replaced by the same sentence: Home card quick actions, Scouting
home (Visit / Scout), Tasks and Todos (Add), the team and season calendars (Add event, Add
milestone, edit/delete) and the chat composer. Other pages keep their buttons; the database
refuses and the API explains.

## Adding a table or a write

- A migration that creates an org-scoped table ends with `SELECT install_view_only_guards();`.
  If the table holds a person's own state, first
  `INSERT INTO view_only_exempt_tables(table_name, reason, added_in) VALUES (…)` with a one-line
  reason, then call the installer (exempting also drops the three guard policies).
- `packages/db/src/view-only-migrations.test.ts` checks every later migration file for that call
  (runs in `npm test`); `packages/db/src/view-only-integration.test.ts` (in
  `npm run test:db:integration`) fails on any org-scoped table that is neither guarded nor exempt,
  and proves a viewer is refused on team tables and allowed on exempt ones.
- A write made while *reading* a page (a cache, a default seed, a reminder sweep) belongs in
  `withSavepoint`, so a refused write costs only that write and the viewer still gets the page.
