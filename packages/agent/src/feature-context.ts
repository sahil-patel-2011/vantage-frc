import type { PoolClient } from "@neondatabase/serverless";

/** Durable link kinds stored in `feature_context_links` (migration 0184). */
export type FeatureContextKind =
  | "strategy_match"
  | "reference_team"
  | "cad_job"
  | "cad_artifact"
  | "build_task"
  | "inventory_item"
  | "purchase_request"
  | "knowledge_page"
  | "sponsor"
  | "budget"
  | "fmea_failure"
  | "scout_entry";

export type FeatureContextRelation =
  | "informs"
  | "implements"
  | "validates"
  | "blocks"
  | "requires"
  | "documents"
  | "funds"
  | "supplies"
  | "derived_from";

/**
 * Authorized cross-feature call graph: who may invoke whom via the shared
 * registry + planner (no copy-paste between engines). Finance tools remain
 * gated by org Finance-in-AI policy at execute time.
 *
 * Soft-UI is presentation-only and is intentionally absent from this graph.
 */
export const CROSS_FEATURE_TOOL_GRAPH = {
  chat: [
    "web.search",
    "web.fetch",
    "knowledge.search",
    "knowledge.get_page",
    "fmea.open_risks",
    "fmea.repeat",
    "my_day.summary",
    "calendar.upcoming",
    "finance.summary",
    "finance.orders",
    "finance.create_purchase_request",
    "kickoff.intelligence",
    "kickoff.rules",
    "rules.compliance",
    "strategy.design",
    "strategy.match",
    "scouting.team",
    "scouting.schema",
    "reference.team",
    "research.findings",
    "cad.briefs",
    "cad.create_brief",
    "inventory.availability",
  ],
  agent: [
    "web.search",
    "web.fetch",
    "knowledge.search",
    "reference.team",
    "research.findings",
    "kickoff.rules",
    "strategy.match",
    "scouting.team",
  ],
  cad: [
    "knowledge.search",
    "knowledge.get_page",
    "kickoff.intelligence",
    "kickoff.rules",
    "rules.compliance",
    "strategy.design",
    "strategy.match",
    "scouting.team",
    "scouting.schema",
    "fmea.open_risks",
    "fmea.repeat",
    "cad.briefs",
    "inventory.availability",
    "finance.orders",
    "finance.create_purchase_request",
    "my_day.summary",
  ],
  strategy: [
    "knowledge.search",
    "kickoff.intelligence",
    "kickoff.rules",
    "rules.compliance",
    "strategy.design",
    "strategy.match",
    "scouting.team",
    "scouting.schema",
    "reference.team",
    "cad.design_context",
    "fmea.open_risks",
    "fmea.repeat",
    "my_day.summary",
  ],
  /** CAD brief job pulls these via planCadStrategyToolCalls (subset of cad). */
  cad_brief: [
    "strategy.match",
    "strategy.design",
    "kickoff.intelligence",
    "kickoff.rules",
    "rules.compliance",
    "fmea.open_risks",
    "fmea.repeat",
    "scouting.team",
    "scouting.schema",
    "cad.briefs",
    "inventory.availability",
    "knowledge.search",
    "knowledge.get_page",
  ],
  /** Bidirectional durable edges written when briefs / handoffs succeed. */
  context_links: {
    "strategy_match→cad_job": "informs",
    "reference_team→cad_job": "informs",
    "inventory_item→cad_job": "supplies",
    "fmea_failure→cad_job": "blocks",
    "knowledge_page→cad_job": "documents",
    "scout_entry→cad_job": "validates",
    "cad_job→purchase_request": "requires",
  },
} as const;

export type CrossFeatureSurface = keyof typeof CROSS_FEATURE_TOOL_GRAPH;

/** Tools that touch org-scoped rows — individual billing needs admin funding approval. */
export const ORG_DATA_TOOL_NAMES = [
  "scouting.team",
  "scouting.schema",
  "strategy.match",
  "strategy.design",
  "artifacts.related",
  "kickoff.intelligence",
  "kickoff.rules",
  "rules.compliance",
  "cad.briefs",
  "cad.design_context",
  "cad.create_brief",
  "inventory.availability",
  "knowledge.search",
  "knowledge.get_page",
  "fmea.open_risks",
  "fmea.repeat",
  "finance.summary",
  "finance.orders",
  "finance.create_purchase_request",
  "my_day.summary",
  "calendar.upcoming",
] as const;

export function toolUsesOrgData(toolName: string): boolean {
  return (ORG_DATA_TOOL_NAMES as readonly string[]).includes(toolName);
}

export async function linkFeatureContext(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sourceKind: FeatureContextKind;
    sourceId: string;
    targetKind: FeatureContextKind;
    targetId: string;
    relation: FeatureContextRelation;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const sourceId = String(input.sourceId ?? "").trim();
  const targetId = String(input.targetId ?? "").trim();
  if (!sourceId || !targetId) return;
  try {
    await client.query(
      `INSERT INTO feature_context_links(
         org_id,source_kind,source_id,target_kind,target_id,relation,metadata,created_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT(org_id,source_kind,source_id,target_kind,target_id,relation) DO NOTHING`,
      [
        input.orgId,
        input.sourceKind,
        sourceId,
        input.targetKind,
        targetId,
        input.relation,
        JSON.stringify(input.metadata ?? {}),
        input.userId,
      ],
    );
  } catch {
    // Migration may not be applied yet — engines must degrade, not crash.
  }
}
