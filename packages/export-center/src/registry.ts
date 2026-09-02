import type { PoolClient } from "@neondatabase/serverless";
import type { CsvValue } from "./csv";

export type ExportScope = "team" | "private";
export type ExportCategory = "scouting" | "reference" | "strategy" | "ai" | "ops";
export type ExportFilters = { eventKey?: string; from?: string; to?: string; excelBom?: boolean };
export type ExportContext = { client: PoolClient; orgId: string; userId: string; scope: ExportScope; filters: ExportFilters };

export type ExportAdapter = {
  id: string;
  fileName: string;
  description: string;
  scope: ExportScope;
  category: ExportCategory;
  provenance: string;
  columns: string[];
  rows(context: ExportContext): AsyncIterable<Record<string, CsvValue>>;
};

export const EXPORT_CATEGORY_LABELS: Record<ExportCategory, string> = {
  scouting: "Scouting",
  reference: "Official reference (TBA)",
  strategy: "Strategy & research",
  ai: "AI artifacts",
  ops: "Ops & billing",
};

export const EXPORT_EXCLUSIONS = [
  "API keys and OAuth / session tokens",
  "Passwords, OTP / MFA secrets or hashes",
  "Encryption material and payment credentials",
  "Display tokens and internal security fields",
  "Invite tokens",
  "Other teams' workspaces (org_id isolation)",
] as const;

/** Team-owned AI artifacts a workspace can take with them. Never keys. */
export const AI_TAKEOUT_TEAM_IDS = [
  "ai-team-conversations",
  "ai-team-memory",
  "ai-team-artifacts",
  "cad-artifacts",
  "cad-team-profile",
  "usage",
] as const;

/** The requesting member's private AI only — not teammates' private threads. */
export const AI_TAKEOUT_PRIVATE_IDS = ["ai-private-conversations", "ai-private-memory"] as const;

export function aiTakeoutDomainIds(scope: ExportScope): string[] {
  return scope === "private" ? [...AI_TAKEOUT_PRIVATE_IDS] : [...AI_TAKEOUT_TEAM_IDS];
}

function sqlAdapter(
  config: Omit<ExportAdapter, "rows"> & { query: string; params?: (context: ExportContext) => unknown[] },
): ExportAdapter {
  return {
    ...config,
    async *rows(context) {
      let offset = 0;
      for (;;) {
        const params = config.params?.(context) ?? [];
        const result = await context.client.query<Record<string, CsvValue>>(
          `${config.query} LIMIT 500 OFFSET $${params.length + 1}`,
          [...params, offset],
        );
        for (const row of result.rows) yield row;
        if (result.rows.length < 500) break;
        offset += 500;
      }
    },
  };
}

export function createExportRegistry() {
  const adapters: ExportAdapter[] = [
    sqlAdapter({
      id: "scouting-match",
      fileName: "scouting_match_entries.csv",
      description: "Match scouting entries and derived payload",
      scope: "team",
      category: "scouting",
      provenance: "Organization match scouting forms (Neon match_scout_entries)",
      columns: ["id", "event_key", "match_key", "team_key", "schema_id", "payload_json", "confidence", "synced_at", "created_at"],
      query: `SELECT id,event_key,match_key,team_key,schema_id,payload::text AS payload_json,confidence,synced_at,created_at FROM match_scout_entries WHERE org_id=$1 AND ($2::text IS NULL OR event_key=$2) ORDER BY created_at,id`,
      params: (c) => [c.orgId, c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "scouting-purple-standard",
      fileName: "scouting_purple_standard.csv",
      description: "Match scouting entries mapped to The Purple Standard interchange fields",
      scope: "team",
      category: "scouting",
      provenance: "Vantage match scouting forms normalized to The Purple Standard",
      columns: ["abilities", "counters", "data", "metadata", "ratings", "timers"],
      query: `SELECT
        '{}'::jsonb::text AS abilities,
        '{}'::jsonb::text AS counters,
        e.payload::text AS data,
        jsonb_strip_nulls(jsonb_build_object(
          'event', e.event_key,
          'match', CASE
            WHEN e.match_key ~ '_qm[0-9]+$' THEN jsonb_build_object(
              'level', 'qm',
              'number', substring(e.match_key from '_qm([0-9]+)$')::integer,
              'set', 1
            )
            WHEN e.match_key ~ '_sf[0-9]+m[0-9]+$' THEN jsonb_build_object(
              'level', 'sf',
              'number', substring(e.match_key from '_sf[0-9]+m([0-9]+)$')::integer,
              'set', substring(e.match_key from '_sf([0-9]+)m[0-9]+$')::integer
            )
            WHEN e.match_key ~ '_f[0-9]+m[0-9]+$' THEN jsonb_build_object(
              'level', 'f',
              'number', substring(e.match_key from '_f[0-9]+m([0-9]+)$')::integer,
              'set', substring(e.match_key from '_f([0-9]+)m[0-9]+$')::integer
            )
            ELSE NULL
          END,
          'bot', regexp_replace(e.team_key, '^frc', ''),
          'scouter', jsonb_strip_nulls(jsonb_build_object(
            'team', o.team_number::text,
            'app', 'Vantage'
          )),
          'timestamp', (extract(epoch FROM e.created_at) * 1000)::bigint,
          'modified-timestamp', (extract(epoch FROM e.updated_at) * 1000)::bigint
        ))::text AS metadata,
        '{}'::jsonb::text AS ratings,
        '{}'::jsonb::text AS timers
      FROM match_scout_entries e
      JOIN organizations o ON o.id=e.org_id
      WHERE e.org_id=$1 AND ($2::text IS NULL OR e.event_key=$2)
      ORDER BY e.created_at,e.id`,
      params: (c) => [c.orgId, c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "scouting-pit",
      fileName: "scouting_pit_entries.csv",
      description: "Pit scouting entries",
      scope: "team",
      category: "scouting",
      provenance: "Organization pit scouting forms (Neon pit_scout_entries)",
      columns: ["id", "event_key", "team_key", "schema_id", "payload_json", "confidence", "synced_at", "created_at"],
      query: `SELECT id,event_key,team_key,schema_id,payload::text AS payload_json,confidence,synced_at,created_at FROM pit_scout_entries WHERE org_id=$1 AND ($2::text IS NULL OR event_key=$2) ORDER BY created_at,id`,
      params: (c) => [c.orgId, c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "scouting-disagreements",
      fileName: "scouting_disagreements.csv",
      description: "Review and disagreement records",
      scope: "team",
      category: "scouting",
      provenance: "Scouting QA disagreements recorded in Neon",
      columns: ["id", "event_key", "match_key", "team_key", "status", "field_key", "entry_ids_json", "values_json", "resolution_json", "reviewed_at", "created_at"],
      query: `SELECT id,event_key,match_key,team_key,status,field_key,entry_ids::text AS entry_ids_json,values::text AS values_json,resolution::text AS resolution_json,reviewed_at,created_at FROM scout_disagreements WHERE org_id=$1 AND ($2::text IS NULL OR event_key=$2) ORDER BY created_at,id`,
      params: (c) => [c.orgId, c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "reference-teams",
      fileName: "reference_teams.csv",
      description: "Platform-global team reference data used by this organization",
      scope: "team",
      category: "reference",
      provenance: "The Blue Alliance via platform cache (teams_ref)",
      columns: ["team_key", "team_number", "nickname", "name", "city", "state_prov", "country", "rookie_year", "website", "synced_at"],
      query: `SELECT team_key,team_number,nickname,name,city,state_prov,country,rookie_year,website,synced_at FROM teams_ref ORDER BY team_number`,
      params: () => [],
    }),
    sqlAdapter({
      id: "reference-events",
      fileName: "reference_events.csv",
      description: "Platform-global event reference data",
      scope: "team",
      category: "reference",
      provenance: "The Blue Alliance via platform cache (events_ref)",
      columns: ["event_key", "year", "name", "start_date", "end_date", "city", "state_prov", "country", "timezone", "synced_at"],
      query: `SELECT event_key,year,name,start_date,end_date,city,state_prov,country,timezone,synced_at FROM events_ref WHERE ($1::text IS NULL OR event_key=$1) ORDER BY year,event_key`,
      params: (c) => [c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "reference-matches",
      fileName: "reference_matches.csv",
      description: "Official-source match schedule and results",
      scope: "team",
      category: "reference",
      provenance: "The Blue Alliance match schedule/results (matches_ref)",
      columns: ["match_key", "event_key", "comp_level", "set_number", "match_number", "red_alliance_json", "blue_alliance_json", "winning_alliance", "event_time", "actual_time", "score_breakdown_json", "synced_at"],
      query: `SELECT match_key,event_key,comp_level,set_number,match_number,red_alliance::text AS red_alliance_json,blue_alliance::text AS blue_alliance_json,winning_alliance,event_time,actual_time,score_breakdown::text AS score_breakdown_json,synced_at FROM matches_ref WHERE ($1::text IS NULL OR event_key=$1) ORDER BY event_key,comp_level,set_number,match_number`,
      params: (c) => [c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "reference-metrics",
      fileName: "reference_metrics.csv",
      description: "TBA and Statbotics metrics with source",
      scope: "team",
      category: "reference",
      provenance: "TBA + Statbotics metrics cache (team_event_metrics)",
      columns: ["team_key", "event_key", "source", "epa_total", "epa_auto", "epa_teleop", "epa_endgame", "opr", "dpr", "ccwm", "rank", "wins", "losses", "ties", "synced_at"],
      query: `SELECT team_key,event_key,source,epa_total,epa_auto,epa_teleop,epa_endgame,opr,dpr,ccwm,rank,wins,losses,ties,synced_at FROM team_event_metrics WHERE ($1::text IS NULL OR event_key=$1) ORDER BY event_key,team_key,source`,
      params: (c) => [c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "research",
      fileName: "research_findings.csv",
      description: "Qualitative findings with source provenance and confidence",
      scope: "team",
      category: "strategy",
      provenance: "Intel research jobs with cited sources (research_findings)",
      columns: ["id", "team_key", "source_url", "source_type", "source_title", "summary", "confidence", "published_at", "found_at", "facts_json"],
      query: `SELECT f.id,f.team_key,f.source_url,f.source_type,f.source_title,f.summary,f.confidence,f.published_at,f.found_at,f.extracted_facts::text AS facts_json FROM research_findings f JOIN research_jobs j ON j.id=f.research_job_id WHERE j.org_id=$1 ORDER BY f.found_at,f.id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "pick-lists",
      fileName: "pick_lists.csv",
      description: "Pick lists and strategy notes",
      scope: "team",
      category: "strategy",
      provenance: "Strategy pick lists authored in Vantage (pick_lists)",
      columns: ["list_id", "event_key", "list_name", "team_key", "rank", "tier", "notes", "updated_at"],
      query: `SELECT l.id AS list_id,l.event_key,l.name AS list_name,e.team_key,e.rank,e.tier,e.notes,e.updated_at FROM pick_lists l JOIN pick_list_entries e ON e.pick_list_id=l.id AND e.org_id=l.org_id WHERE l.org_id=$1 AND ($2::text IS NULL OR l.event_key=$2) ORDER BY l.name,e.rank`,
      params: (c) => [c.orgId, c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "displays",
      fileName: "display_boards.csv",
      description: "Display board configuration without display tokens",
      scope: "team",
      category: "ops",
      provenance: "Pit display board presets (display_boards, tokens excluded)",
      columns: ["id", "name", "preset", "widgets_json", "created_at", "updated_at"],
      query: `SELECT id,name,preset,widgets::text AS widgets_json,created_at,updated_at FROM display_boards WHERE org_id=$1 ORDER BY name`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "live-alerts",
      fileName: "live_alerts.csv",
      description: "Organization-private live alerts and source provenance",
      scope: "team",
      category: "ops",
      provenance: "Competition live alert feed (org_live_alerts)",
      columns: ["id", "event_key", "type", "severity", "title", "body", "source_refs_json", "acknowledged_at", "created_at"],
      query: `SELECT id,event_key,type,severity,title,body,source_refs::text AS source_refs_json,acknowledged_at,created_at FROM org_live_alerts WHERE org_id=$1 AND ($2::text IS NULL OR event_key=$2) ORDER BY created_at,id`,
      params: (c) => [c.orgId, c.filters.eventKey ?? null],
    }),
    sqlAdapter({
      id: "ai-artifacts",
      fileName: "ai_artifacts.csv",
      description: "Generated artifacts, versions, and claim provenance",
      scope: "team",
      category: "ai",
      provenance: "Team-shared AI artifacts with claim provenance (ai_artifacts)",
      columns: ["id", "run_id", "thread_id", "parent_artifact_id", "kind", "title", "version", "content_json", "claim_provenance_json", "created_at"],
      query: `SELECT id,run_id,thread_id,parent_artifact_id,kind,title,version,content::text AS content_json,claim_provenance::text AS claim_provenance_json,created_at FROM ai_artifacts WHERE org_id=$1 ORDER BY created_at,id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "cad-jobs",
      fileName: "cad_jobs.csv",
      description: "CAD engineering briefs and safe job metadata without credentials or leases",
      scope: "team",
      category: "ai",
      provenance: "CAD agent jobs (cad_jobs, credentials excluded)",
      columns: ["id", "created_by", "thread_id", "execution_mode", "platform", "title", "status", "brief_json", "brief_confirmed_at", "action_plan_json", "completed_at", "created_at", "updated_at"],
      query: `SELECT id,created_by,thread_id,execution_mode,platform,title,status,brief::text AS brief_json,brief_confirmed_at,action_plan::text AS action_plan_json,completed_at,created_at,updated_at FROM cad_jobs WHERE org_id=$1 ORDER BY created_at,id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "cad-artifacts",
      fileName: "cad_artifacts.csv",
      description: "Text-safe CAD artifact metadata, BOM/brief content, versions, checksums and provenance",
      scope: "team",
      category: "ai",
      provenance: "CAD agent artifacts (cad_artifacts)",
      columns: ["id", "job_id", "step_id", "type", "title", "version", "parent_artifact_id", "content_json", "checksum", "source_refs_json", "created_at"],
      query: `SELECT id,job_id,step_id,type,title,version,parent_artifact_id,content::text AS content_json,checksum,source_refs::text AS source_refs_json,created_at FROM cad_artifacts WHERE org_id=$1 ORDER BY created_at,id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "cad-team-profile",
      fileName: "cad_team_profile.csv",
      description: "Shared team manufacturing standards used to ground adaptive CAD plans",
      scope: "team",
      category: "ai",
      provenance: "Team-shared CAD manufacturing profile; private user response preferences excluded",
      columns: ["default_platform", "preferred_units", "manufacturing_processes_json", "preferred_materials_json", "standard_components_json", "design_rules_json", "updated_at"],
      query: `SELECT default_platform,preferred_units,to_json(manufacturing_processes)::text AS manufacturing_processes_json,to_json(preferred_materials)::text AS preferred_materials_json,to_json(standard_components)::text AS standard_components_json,to_json(design_rules)::text AS design_rules_json,updated_at FROM cad_team_profiles WHERE org_id=$1`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "awards",
      fileName: "award_submissions.csv",
      description: "FIRST award submissions with every essay / question answer (metadata + answers)",
      scope: "team",
      category: "ops",
      provenance: "Award workbench submissions and drafted answers (award_submissions + award_items); owner / assignee identity excluded",
      columns: [
        "submission_id",
        "season_year",
        "event_key",
        "award_type",
        "title",
        "status",
        "priority",
        "deadline",
        "summary",
        "item_id",
        "item_kind",
        "prompt",
        "content",
        "char_limit",
        "done",
        "sort_order",
        "item_updated_at",
      ],
      query: `SELECT s.id AS submission_id,s.season_year,s.event_key,s.award_type,s.title,s.status::text AS status,s.priority,s.deadline,s.summary,i.id AS item_id,i.kind::text AS item_kind,i.prompt,i.content,i.char_limit,i.done,i.sort_order,i.updated_at AS item_updated_at FROM award_submissions s LEFT JOIN award_items i ON i.submission_id=s.id AND i.org_id=s.org_id WHERE s.org_id=$1 ORDER BY s.season_year,s.created_at,s.id,i.sort_order,i.id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "feature-context-links",
      fileName: "feature_context_links.csv",
      description: "Auditable relationships between strategy, CAD, inventory, tasks, knowledge, finance, and team evidence",
      scope: "team",
      category: "ops",
      provenance: "Organization cross-feature context graph (feature_context_links)",
      columns: ["id", "source_kind", "source_id", "target_kind", "target_id", "relation", "metadata_json", "created_at"],
      query: `SELECT id,source_kind,source_id,target_kind,target_id,relation,metadata::text AS metadata_json,created_at FROM feature_context_links WHERE org_id=$1 ORDER BY created_at,id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "ai-team-conversations",
      fileName: "ai_team_conversations.csv",
      description: "Explicitly team-shared conversation messages",
      scope: "team",
      category: "ai",
      provenance: "Agent threads explicitly shared with the team",
      columns: ["thread_id", "thread_title", "message_id", "role", "content", "provider", "model", "created_at"],
      query: `SELECT t.id AS thread_id,t.title AS thread_title,m.id AS message_id,m.role,m.content,m.provider,m.model,m.created_at FROM agent_threads t JOIN agent_messages m ON m.thread_id=t.id AND m.org_id=t.org_id WHERE t.org_id=$1 AND t.scope='team' AND m.explicitly_shared=true ORDER BY t.created_at,m.created_at`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "ai-team-memory",
      fileName: "ai_team_memory.csv",
      description: "Opt-in team-shared durable AI memory for this workspace only",
      scope: "team",
      category: "ai",
      provenance: "team_memories rows for this org_id — never another team's memory",
      columns: ["id", "content", "importance", "source_thread_id", "created_at", "updated_at"],
      query: `SELECT id,content,importance,source_thread_id,created_at,updated_at FROM team_memories WHERE org_id=$1 AND disabled_at IS NULL ORDER BY created_at,id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "ai-team-artifacts",
      fileName: "ai_team_artifacts.csv",
      description: "AI run artifacts (briefs, drafts) stored for this workspace",
      scope: "team",
      category: "ai",
      provenance: "ai_artifacts for this org_id; no API keys",
      columns: ["id", "run_id", "kind", "title", "version", "content_json", "created_at"],
      query: `SELECT id,run_id,kind,title,version,content::text AS content_json,created_at FROM ai_artifacts WHERE org_id=$1 ORDER BY created_at,id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "ai-private-conversations",
      fileName: "ai_private_conversations.csv",
      description: "Requesting user's private conversations only",
      scope: "private",
      category: "ai",
      provenance: "Private agent threads owned by the requesting user",
      columns: ["thread_id", "thread_title", "message_id", "role", "content", "provider", "model", "created_at"],
      query: `SELECT t.id AS thread_id,t.title AS thread_title,m.id AS message_id,m.role,m.content,m.provider,m.model,m.created_at FROM agent_threads t JOIN agent_messages m ON m.thread_id=t.id AND m.org_id=t.org_id WHERE t.org_id=$1 AND t.scope='private' AND t.created_by=$2 ORDER BY t.created_at,m.created_at`,
      params: (c) => [c.orgId, c.userId],
    }),
    sqlAdapter({
      id: "ai-private-memory",
      fileName: "ai_private_memory.csv",
      description: "Requesting user's private durable memory only",
      scope: "private",
      category: "ai",
      provenance: "Private durable memory rows for the requesting user",
      columns: ["id", "kind", "content", "source_thread_id", "source_message_id", "importance", "created_at", "updated_at"],
      query: `SELECT id,kind,content,source_thread_id,source_message_id,importance,created_at,updated_at FROM user_memories WHERE user_id=$1 ORDER BY created_at,id`,
      params: (c) => [c.userId],
    }),
    sqlAdapter({
      id: "usage",
      fileName: "ai_usage.csv",
      description: "Organization AI usage and model cost ledger",
      scope: "team",
      category: "ops",
      provenance: "Metered AI usage ledger (ai_usage_events)",
      columns: ["id", "user_id", "feature", "provider", "model", "key_source", "prompt_tokens", "completion_tokens", "total_tokens", "cost_usd", "created_at"],
      query: `SELECT id,user_id,feature,provider,model,key_source,prompt_tokens,completion_tokens,total_tokens,cost_usd,created_at FROM ai_usage_events WHERE org_id=$1 ORDER BY created_at,id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "wallet",
      fileName: "wallet_ledger.csv",
      description: "Usage credits ledger with cost and markup separated",
      scope: "team",
      category: "ops",
      provenance: "Billing wallet ledger (wallet_ledger)",
      columns: ["id", "kind", "amount_usd", "provider_cost_usd", "service_markup_usd", "reason", "created_at"],
      query: `SELECT id,kind,amount_usd,provider_cost_usd,service_markup_usd,reason,created_at FROM wallet_ledger WHERE org_id=$1 ORDER BY created_at,id`,
      params: (c) => [c.orgId],
    }),
    sqlAdapter({
      id: "hours",
      fileName: "build_hours.csv",
      description: "Shop-time clock-in/out log per member, with auto-close flags and linked calendar sessions",
      scope: "team",
      category: "ops",
      provenance: "Build hours log (hour_logs); open sessions have no clock_out, auto-closed rows are flagged",
      columns: ["id", "user_id", "member_name", "kind", "clock_in", "clock_out", "minutes", "auto_closed", "auto_closed_reason", "note", "calendar_event_id", "occurrence_date", "created_at"],
      query: `SELECT r.id,r.user_id,u.name AS member_name,r.kind,r.clock_in,r.clock_out,
        CASE WHEN r.clock_out IS NULL THEN NULL ELSE round(extract(epoch FROM (r.clock_out-r.clock_in))/60)::int END AS minutes,
        r.auto_closed,r.auto_closed_reason,r.note,r.calendar_event_id,r.occurrence_date,r.created_at
        FROM hour_logs r JOIN users u ON u.id=r.user_id
        WHERE r.org_id=$1 AND ($2::date IS NULL OR r.clock_in>=$2::date) AND ($3::date IS NULL OR r.clock_in<($3::date+interval '1 day'))
        ORDER BY r.clock_in,r.id`,
      params: (c) => [c.orgId, c.filters.from ?? null, c.filters.to ?? null],
    }),
    sqlAdapter({
      id: "membership",
      fileName: "membership_and_invites.csv",
      description: "Membership and invitation status without invite tokens",
      scope: "team",
      category: "ops",
      provenance: "Membership roster and invites (tokens excluded)",
      columns: ["record_type", "user_id", "email", "role", "status", "expires_at", "accepted_at", "created_at"],
      query: `SELECT 'membership' AS record_type,m.user_id,u.email,m.role,'active' AS status,NULL::timestamptz AS expires_at,NULL::timestamptz AS accepted_at,m.created_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 UNION ALL SELECT 'invite',NULL,i.email,i.role,i.status,i.expires_at,i.accepted_at,i.created_at FROM invites i WHERE i.org_id=$1 ORDER BY created_at`,
      params: (c) => [c.orgId],
    }),
  ];
  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}
