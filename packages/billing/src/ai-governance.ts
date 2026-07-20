import type { PoolClient } from "@neondatabase/serverless";
import { CommitAndThrowError } from "@vantage/db";

export class ApprovalRequiredError extends Error {
  constructor(
    readonly approvalId: string,
    readonly reason: string,
  ) {
    super(`AI run requires administrator approval (${reason}). Approval id: ${approvalId}`);
    this.name = "ApprovalRequiredError";
  }
}

export class AiPolicyDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`AI policy denied this request (${reason}).`);
    this.name = "AiPolicyDeniedError";
  }
}

/** Bump when risk-acceptance modal copy changes — forces re-acceptance. */
export const FINANCE_IN_AI_ACK_VERSION = "2026-07-17";

export type OrgAiPolicy = {
  featureAllowlistEnabled: boolean;
  allowedFeatures: string[];
  toolAllowlistEnabled: boolean;
  allowedTools: string[];
  highCostThresholdUsd: number | null;
  requireApprovalAboveThreshold: boolean;
  requireApprovalForFeatures: string[];
  adminBypassApproval: boolean;
  dailySpendAlertUsd: number | null;
  monthlySpendAlertUsd: number | null;
  spendAlertThresholds: number[];
  /** Org admin opt-in: AI may read redacted team financial summaries. */
  financeInAiEnabled: boolean;
  financeInAiAcceptedAt: string | null;
  financeInAiAcceptedBy: string | null;
  financeInAiAckVersion: string | null;
};

export const DEFAULT_ORG_AI_POLICY: OrgAiPolicy = {
  featureAllowlistEnabled: false,
  allowedFeatures: [],
  toolAllowlistEnabled: false,
  allowedTools: [],
  highCostThresholdUsd: null,
  requireApprovalAboveThreshold: false,
  requireApprovalForFeatures: [],
  adminBypassApproval: true,
  dailySpendAlertUsd: null,
  monthlySpendAlertUsd: null,
  spendAlertThresholds: [50, 75, 90],
  financeInAiEnabled: false,
  financeInAiAcceptedAt: null,
  financeInAiAcceptedBy: null,
  financeInAiAckVersion: null,
};

const KNOWN_FEATURES = [
  "strategy",
  "team_intel",
  "research",
  "prediction",
  "cad",
  "coding",
  "maintenance",
  "chat",
  "writer",
  "scout_voice_stt",
  "agent",
] as const;

const KNOWN_TOOLS = [
  "reference.team",
  "scouting.team",
  "scouting.schema",
  "strategy.match",
  "strategy.design",
  "research.findings",
  "artifacts.related",
  "kickoff.intelligence",
  "kickoff.rules",
  "rules.compliance",
  "cad.briefs",
  "fmea.repeat",
  "knowledge.search",
  "knowledge.get_page",
  "my_day.summary",
  "calendar.upcoming",
  "finance.summary",
  "finance.orders",
  "finance.create_purchase_request",
  "web.search",
  "web.fetch",
] as const;

export function knownAiFeatures() {
  return [...KNOWN_FEATURES];
}

export function knownAiTools() {
  return [...KNOWN_TOOLS];
}

export function normalizeStringList(value: unknown, max = 64): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = String(entry ?? "")
      .trim()
      .toLowerCase();
    if (!normalized || normalized.length > 80) continue;
    seen.add(normalized);
    if (seen.size >= max) break;
  }
  return [...seen];
}

export function normalizeThresholds(value: unknown, fallback = [50, 75, 90]): number[] {
  const source = Array.isArray(value) ? value : fallback;
  const cleaned = source
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 99);
  const unique = [...new Set(cleaned)].sort((a, b) => a - b);
  return unique.length ? unique.slice(0, 10) : fallback;
}

export function parseOptionalUsd(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("USD amounts must be non-negative numbers");
  }
  return amount;
}

export function isFeatureAllowed(policy: OrgAiPolicy, feature: string): boolean {
  if (!policy.featureAllowlistEnabled) return true;
  const needle = feature.trim().toLowerCase();
  return policy.allowedFeatures.some((entry) => entry === needle);
}

export function isToolAllowed(policy: OrgAiPolicy, toolName: string): boolean {
  if (!policy.toolAllowlistEnabled) return true;
  const needle = toolName.trim().toLowerCase();
  return policy.allowedTools.some((entry) => entry === needle || entry === "*");
}

/** True only when enabled and risk acceptance matches the current ack version. */
export function isFinanceInAiAllowed(policy: OrgAiPolicy): boolean {
  return (
    policy.financeInAiEnabled &&
    Boolean(policy.financeInAiAcceptedAt) &&
    policy.financeInAiAckVersion === FINANCE_IN_AI_ACK_VERSION
  );
}

export function isFinanceAiTool(toolName: string): boolean {
  return toolName.trim().toLowerCase().startsWith("finance.");
}

export function needsAiApproval(
  policy: OrgAiPolicy,
  input: { feature: string; estimatedCostUsd: number; isOrgAdmin: boolean },
): { required: boolean; reason: string | null } {
  if (policy.adminBypassApproval && input.isOrgAdmin) {
    return { required: false, reason: null };
  }
  const feature = input.feature.trim().toLowerCase();
  if (policy.requireApprovalForFeatures.some((entry) => entry === feature)) {
    return { required: true, reason: "feature.requires_approval" };
  }
  if (
    policy.requireApprovalAboveThreshold &&
    policy.highCostThresholdUsd !== null &&
    input.estimatedCostUsd >= policy.highCostThresholdUsd
  ) {
    return { required: true, reason: "cost.above_threshold" };
  }
  return { required: false, reason: null };
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function mapOrgAiPolicyRow(row: Record<string, unknown> | undefined): OrgAiPolicy {
  if (!row) return { ...DEFAULT_ORG_AI_POLICY };
  return {
    featureAllowlistEnabled: Boolean(row.feature_allowlist_enabled ?? row.featureAllowlistEnabled),
    allowedFeatures: normalizeStringList(row.allowed_features ?? row.allowedFeatures),
    toolAllowlistEnabled: Boolean(row.tool_allowlist_enabled ?? row.toolAllowlistEnabled),
    allowedTools: normalizeStringList(row.allowed_tools ?? row.allowedTools),
    highCostThresholdUsd: numberOrNull(row.high_cost_threshold_usd ?? row.highCostThresholdUsd),
    requireApprovalAboveThreshold: Boolean(
      row.require_approval_above_threshold ?? row.requireApprovalAboveThreshold,
    ),
    requireApprovalForFeatures: normalizeStringList(
      row.require_approval_for_features ?? row.requireApprovalForFeatures,
    ),
    adminBypassApproval:
      row.admin_bypass_approval === undefined && row.adminBypassApproval === undefined
        ? true
        : Boolean(row.admin_bypass_approval ?? row.adminBypassApproval),
    dailySpendAlertUsd: numberOrNull(row.daily_spend_alert_usd ?? row.dailySpendAlertUsd),
    monthlySpendAlertUsd: numberOrNull(row.monthly_spend_alert_usd ?? row.monthlySpendAlertUsd),
    spendAlertThresholds: normalizeThresholds(
      row.spend_alert_thresholds ?? row.spendAlertThresholds,
    ),
    financeInAiEnabled: Boolean(row.finance_in_ai_enabled ?? row.financeInAiEnabled),
    financeInAiAcceptedAt: stringOrNull(row.finance_in_ai_accepted_at ?? row.financeInAiAcceptedAt),
    financeInAiAcceptedBy: stringOrNull(row.finance_in_ai_accepted_by ?? row.financeInAiAcceptedBy),
    financeInAiAckVersion: stringOrNull(row.finance_in_ai_ack_version ?? row.financeInAiAckVersion),
  };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export async function loadOrgAiPolicy(client: PoolClient, orgId: string): Promise<OrgAiPolicy> {
  const result = await client.query(
    `SELECT feature_allowlist_enabled, allowed_features, tool_allowlist_enabled, allowed_tools,
            high_cost_threshold_usd, require_approval_above_threshold, require_approval_for_features,
            admin_bypass_approval, daily_spend_alert_usd, monthly_spend_alert_usd, spend_alert_thresholds,
            finance_in_ai_enabled, finance_in_ai_accepted_at, finance_in_ai_accepted_by,
            finance_in_ai_ack_version
     FROM org_ai_policies WHERE org_id=$1`,
    [orgId],
  );
  return mapOrgAiPolicyRow(result.rows[0] as Record<string, unknown> | undefined);
}

async function isOrgAdmin(client: PoolClient, orgId: string, userId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
    [orgId, userId],
  );
  return Boolean(result.rowCount);
}

/** Enforce feature allowlist + high-cost approval before a metered provider call. */
export async function enforceOrgAiGovernance(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  feature: string;
  requestId: string;
  estimatedCostUsd: number;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const policy = await loadOrgAiPolicy(input.client, input.orgId);
  if (!isFeatureAllowed(policy, input.feature)) {
    await input.client.query(
      `INSERT INTO api_usage_denials(org_id,user_id,feature,provider,model,estimated_cost_usd,
        estimated_tokens,reason,request_id,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT(request_id) DO NOTHING`,
      [
        input.orgId,
        input.userId,
        input.feature,
        input.provider ?? null,
        input.model ?? null,
        input.estimatedCostUsd,
        0,
        "feature.not_allowed",
        input.requestId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    throw new CommitAndThrowError(new AiPolicyDeniedError("feature.not_allowed"));
  }

  const admin = await isOrgAdmin(input.client, input.orgId, input.userId);
  const gate = needsAiApproval(policy, {
    feature: input.feature,
    estimatedCostUsd: input.estimatedCostUsd,
    isOrgAdmin: admin,
  });
  if (!gate.required || !gate.reason) return;

  // New request ids are required (ai_runs.request_id is unique); consume a prior grant.
  const grant = await input.client.query<{ id: string }>(
    `SELECT id FROM ai_run_approvals
     WHERE org_id=$1 AND requester_user_id=$2 AND feature=$3 AND status='approved'
       AND estimated_cost_usd + 0.000001 >= $4
       AND created_at >= now() - interval '24 hours'
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE`,
    [input.orgId, input.userId, input.feature, input.estimatedCostUsd],
  );
  if (grant.rows[0]) {
    await input.client.query(
      `UPDATE ai_run_approvals SET status='consumed', consumed_at=now()
       WHERE id=$1 AND org_id=$2 AND status='approved'`,
      [grant.rows[0].id, input.orgId],
    );
    return;
  }

  const existing = await input.client.query<{ id: string; status: string }>(
    `SELECT id, status FROM ai_run_approvals WHERE org_id=$1 AND request_id=$2`,
    [input.orgId, input.requestId],
  );
  const row = existing.rows[0];
  if (row?.status === "denied") {
    throw new CommitAndThrowError(new AiPolicyDeniedError("approval.denied"));
  }
  if (row?.status === "approved" || row?.status === "consumed") return;

  const tools = Array.isArray(input.metadata?.tools)
    ? (input.metadata.tools as Array<{ name?: string }>)
        .map((tool) => String(tool.name ?? "").trim())
        .filter(Boolean)
    : [];
  const runId =
    typeof input.metadata?.runId === "string" && input.metadata.runId
      ? input.metadata.runId
      : null;

  const inserted = await input.client.query<{ id: string }>(
    `INSERT INTO ai_run_approvals(
       org_id, run_id, request_id, requester_user_id, feature, provider, model,
       estimated_cost_usd, tools, status, reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],'pending',$10)
     ON CONFLICT (org_id, request_id) DO UPDATE SET
       estimated_cost_usd=EXCLUDED.estimated_cost_usd,
       tools=EXCLUDED.tools,
       reason=EXCLUDED.reason,
       run_id=COALESCE(EXCLUDED.run_id, ai_run_approvals.run_id)
     WHERE ai_run_approvals.status='pending'
     RETURNING id`,
    [
      input.orgId,
      runId,
      input.requestId,
      input.userId,
      input.feature,
      input.provider ?? null,
      input.model ?? null,
      input.estimatedCostUsd,
      tools,
      gate.reason,
    ],
  );
  const approvalId = inserted.rows[0]?.id ?? row?.id;
  if (!approvalId) {
    throw new CommitAndThrowError(new AiPolicyDeniedError("approval.unavailable"));
  }

  await input.client.query(
    `INSERT INTO api_usage_denials(org_id,user_id,feature,provider,model,estimated_cost_usd,
      estimated_tokens,reason,request_id,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT(request_id) DO NOTHING`,
    [
      input.orgId,
      input.userId,
      input.feature,
      input.provider ?? null,
      input.model ?? null,
      input.estimatedCostUsd,
      0,
      "approval.required",
      input.requestId,
      JSON.stringify({ ...(input.metadata ?? {}), approvalId }),
    ],
  );

  if (runId) {
    await input.client.query(
      `UPDATE ai_runs SET status='awaiting_approval', error=$2, completed_at=now() WHERE id=$1 AND org_id=$3`,
      [runId, `Awaiting approval: ${gate.reason}`, input.orgId],
    );
  }

  throw new CommitAndThrowError(new ApprovalRequiredError(approvalId, gate.reason));
}

export async function emitAbsoluteSpendAlerts(client: PoolClient, orgId: string): Promise<void> {
  const result = await client.query<{
    dailyAlert: string | null;
    monthlyAlert: string | null;
    dailySpend: string;
    monthlySpend: string;
  }>(
    `SELECT p.daily_spend_alert_usd AS "dailyAlert",
            p.monthly_spend_alert_usd AS "monthlyAlert",
            COALESCE(sum(a.cost_usd) FILTER (WHERE a.created_at >= date_trunc('day', now())), 0)::text AS "dailySpend",
            COALESCE(sum(a.cost_usd), 0)::text AS "monthlySpend"
     FROM org_ai_policies p
     LEFT JOIN ai_usage_events a
       ON a.org_id = p.org_id AND a.created_at >= date_trunc('month', now())
     WHERE p.org_id = $1
     GROUP BY p.org_id, p.daily_spend_alert_usd, p.monthly_spend_alert_usd`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return;

  const alerts: Array<{ type: string; payload: Record<string, unknown> }> = [];
  if (row.dailyAlert !== null && Number(row.dailySpend) >= Number(row.dailyAlert)) {
    alerts.push({
      type: "ai_spend.alert.daily",
      payload: {
        thresholdUsd: Number(row.dailyAlert),
        currentUsd: Number(row.dailySpend),
        window: "day",
        delivery: ["in_app", "email"],
      },
    });
  }
  if (row.monthlyAlert !== null && Number(row.monthlySpend) >= Number(row.monthlyAlert)) {
    alerts.push({
      type: "ai_spend.alert.monthly",
      payload: {
        thresholdUsd: Number(row.monthlyAlert),
        currentUsd: Number(row.monthlySpend),
        window: "month",
        delivery: ["in_app", "email"],
      },
    });
  }

  for (const alert of alerts) {
    await client.query(
      `INSERT INTO notifications(user_id, org_id, type, payload)
       SELECT m.user_id, $1, $2, $3::jsonb FROM memberships m
       WHERE m.org_id = $1 AND m.role IN ('owner', 'admin') AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_id = m.user_id AND n.org_id = $1
           AND n.type = $2 AND n.created_at >= date_trunc('day', now())
       )`,
      [orgId, alert.type, JSON.stringify(alert.payload)],
    );
  }
}
