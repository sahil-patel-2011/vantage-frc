import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import {
  CAD_MODE_PROPOSAL_TTL_MS,
  isCadAgentMode,
  isModeProposalExpired,
  normalizeCadTasks,
  withPlanDryRun,
  type CadAgentMode,
  type CadPlanStep,
  type CadTask,
} from "@vantage/cad";
import { CAD_AGENT_JOB_TITLE, saveCadAgentSession } from "./cad-agent-session";

export type CadStoredPlan = {
  /** Stable id for one generated plan; namespaces its cad_job_steps rows. */
  planId: string;
  brief: string;
  steps: CadPlanStep[];
  questions: string[];
  answers: string[];
  approved: boolean;
};

export const CAD_PLAN_STEP_STATUSES = ["planned", "running", "completed", "failed", "skipped", "cancelled"] as const;
export type CadPlanStepStatus = (typeof CAD_PLAN_STEP_STATUSES)[number];

export const CAD_PLAN_APPROVALS = ["pending", "approved", "rejected"] as const;
export type CadPlanApproval = (typeof CAD_PLAN_APPROVALS)[number];

/** Per-step outcome, read back from cad_job_steps. */
export type CadPlanRunStep = {
  sequence: number;
  index: number;
  tool: string;
  title: string;
  status: CadPlanStepStatus;
  approvalStatus: CadPlanApproval;
  featureId: string | null;
  error: string | null;
  narration: string | null;
  vaultHref: string | null;
};

export type CadAgentModeState = {
  mode: CadAgentMode;
  proposal: { mode: CadAgentMode; proposedAt: string; expiresAt: string } | null;
  plan: CadStoredPlan | null;
  /** Outcome rows for `plan` (same order as plan.steps that carry a sequence). */
  planRun: CadPlanRunStep[] | null;
  tasks: CadTask[] | null;
};

export type CadAgentModeRow = {
  mode: unknown;
  proposed_mode: unknown;
  proposed_at: Date | string | null;
  plan: unknown;
  tasks: unknown;
};

export const DEFAULT_CAD_AGENT_MODE_STATE: CadAgentModeState = {
  mode: "simple",
  proposal: null,
  plan: null,
  planRun: null,
  tasks: null,
};

function asArgs(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

export function normalizeStoredPlan(raw: unknown): CadStoredPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps: CadPlanStep[] = [];
  for (const item of rawSteps.slice(0, 20)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const step = item as Record<string, unknown>;
    const title = typeof step.title === "string" ? step.title.trim() : "";
    if (!title) continue;
    const normalized: CadPlanStep = {
      index: steps.length + 1,
      title,
      detail: typeof step.detail === "string" ? step.detail : "",
    };
    if (typeof step.tool === "string" && step.tool.trim()) {
      normalized.tool = step.tool.trim();
      normalized.args = asArgs(step.args) ?? {};
    }
    if (Number.isInteger(step.sequence) && (step.sequence as number) > 0) normalized.sequence = step.sequence as number;
    steps.push(withPlanDryRun(normalized));
  }
  if (!steps.length) return null;
  const questions = Array.isArray(record.questions)
    ? record.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 10)
    : [];
  const answers = Array.isArray(record.answers)
    ? record.answers.map((a) => (typeof a === "string" ? a : "")).slice(0, questions.length || 10)
    : [];
  return {
    planId: typeof record.planId === "string" && record.planId ? record.planId : "legacy",
    brief: typeof record.brief === "string" ? record.brief : "",
    steps,
    questions,
    answers,
    approved: record.approved === true,
  };
}

/**
 * Pure normalization of the cad_jobs mode columns. Enforces the 15-second rule
 * server-side: a proposal older than the TTL is reported as absent (declined),
 * so a reload cannot resurrect an expired countdown.
 */
export function modeStateFromRow(
  row: CadAgentModeRow | null | undefined,
  now: number = Date.now(),
  planRun: CadPlanRunStep[] | null = null,
): CadAgentModeState {
  if (!row) return DEFAULT_CAD_AGENT_MODE_STATE;
  const mode: CadAgentMode = isCadAgentMode(row.mode) ? row.mode : "simple";
  let proposal: CadAgentModeState["proposal"] = null;
  if (isCadAgentMode(row.proposed_mode) && row.proposed_at && !isModeProposalExpired(row.proposed_at, now)) {
    const proposedAtMs =
      row.proposed_at instanceof Date ? row.proposed_at.getTime() : new Date(row.proposed_at).getTime();
    proposal = {
      mode: row.proposed_mode,
      proposedAt: new Date(proposedAtMs).toISOString(),
      expiresAt: new Date(proposedAtMs + CAD_MODE_PROPOSAL_TTL_MS).toISOString(),
    };
  }
  const plan = normalizeStoredPlan(row.plan);
  return {
    mode,
    proposal,
    plan,
    planRun: plan ? planRun : null,
    tasks: normalizeCadTasks(row.tasks),
  };
}

const MODE_COLUMNS = "mode, proposed_mode, proposed_at, plan, tasks";

async function findModeRow(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<{ jobId: string; row: CadAgentModeRow } | null> {
  const result = await client.query<CadAgentModeRow & { id: string }>(
    `SELECT id, ${MODE_COLUMNS} FROM cad_jobs
     WHERE org_id=$1::uuid AND created_by=$2::uuid AND title=$3
     ORDER BY updated_at DESC LIMIT 1`,
    [orgId, userId, CAD_AGENT_JOB_TITLE],
  );
  const row = result.rows[0];
  return row ? { jobId: row.id, row } : null;
}

async function ensureModeRow(client: PoolClient, orgId: string, userId: string): Promise<string> {
  const existing = await findModeRow(client, orgId, userId);
  if (existing) return existing.jobId;
  // Reuse the canonical session writer so the singleton "CAD agent" job row is
  // created the same way bind/chat create it.
  const saved = await saveCadAgentSession(client, { orgId, userId, connectionId: null, session: {} });
  return saved.jobId;
}

export async function loadCadAgentModeState(
  client: PoolClient,
  orgId: string,
  userId: string,
  now: number = Date.now(),
): Promise<CadAgentModeState> {
  const found = await findModeRow(client, orgId, userId);
  if (!found) return DEFAULT_CAD_AGENT_MODE_STATE;
  const plan = normalizeStoredPlan(found.row.plan);
  const planRun = plan && plan.planId !== "legacy" ? await loadPlanRun(client, { orgId, jobId: found.jobId, planId: plan.planId }) : null;
  return modeStateFromRow(found.row, now, planRun);
}

/** Manual mode switch — no consent flow. Clears any pending proposal. */
export async function setCadAgentMode(
  client: PoolClient,
  input: { orgId: string; userId: string; mode: CadAgentMode },
): Promise<CadAgentModeState> {
  const jobId = await ensureModeRow(client, input.orgId, input.userId);
  await client.query(
    `UPDATE cad_jobs SET mode=$3, proposed_mode=NULL, proposed_at=NULL, updated_at=now()
     WHERE id=$1::uuid AND org_id=$2::uuid`,
    [jobId, input.orgId, input.mode],
  );
  return loadCadAgentModeState(client, input.orgId, input.userId);
}

/** Store a consent-gated switch proposal; the countdown starts server-side at proposed_at. */
export async function proposeCadAgentMode(
  client: PoolClient,
  input: { orgId: string; userId: string; mode: CadAgentMode },
): Promise<CadAgentModeState> {
  const jobId = await ensureModeRow(client, input.orgId, input.userId);
  await client.query(
    `UPDATE cad_jobs SET proposed_mode=$3, proposed_at=now(), updated_at=now()
     WHERE id=$1::uuid AND org_id=$2::uuid`,
    [jobId, input.orgId, input.mode],
  );
  return loadCadAgentModeState(client, input.orgId, input.userId);
}

/**
 * Resolve a proposal. Accept only applies when the stored proposal is still
 * inside the 15-second window; a No, an expiry, or a missing proposal all keep
 * the original mode. Either way the proposal columns are cleared.
 */
export async function resolveCadAgentModeProposal(
  client: PoolClient,
  input: { orgId: string; userId: string; accept: boolean; now?: number },
): Promise<{ state: CadAgentModeState; applied: boolean; expired: boolean }> {
  const now = input.now ?? Date.now();
  const found = await findModeRow(client, input.orgId, input.userId);
  if (!found) return { state: DEFAULT_CAD_AGENT_MODE_STATE, applied: false, expired: false };
  const proposedMode = isCadAgentMode(found.row.proposed_mode) ? found.row.proposed_mode : null;
  const expired = isModeProposalExpired(found.row.proposed_at, now);
  const applied = Boolean(input.accept && proposedMode && !expired);
  await client.query(
    applied
      ? `UPDATE cad_jobs SET mode=$3, proposed_mode=NULL, proposed_at=NULL, updated_at=now()
         WHERE id=$1::uuid AND org_id=$2::uuid`
      : `UPDATE cad_jobs SET proposed_mode=NULL, proposed_at=NULL, updated_at=now()
         WHERE id=$1::uuid AND org_id=$2::uuid`,
    applied ? [found.jobId, input.orgId, proposedMode] : [found.jobId, input.orgId],
  );
  return {
    state: await loadCadAgentModeState(client, input.orgId, input.userId),
    applied,
    expired: Boolean(proposedMode) && expired,
  };
}

export async function saveCadAgentPlan(
  client: PoolClient,
  input: { orgId: string; userId: string; plan: CadStoredPlan | null },
): Promise<void> {
  const jobId = await ensureModeRow(client, input.orgId, input.userId);
  await client.query(
    `UPDATE cad_jobs SET plan=$3::jsonb, updated_at=now() WHERE id=$1::uuid AND org_id=$2::uuid`,
    [jobId, input.orgId, input.plan ? JSON.stringify(input.plan) : null],
  );
}

export async function saveCadAgentTasks(
  client: PoolClient,
  input: { orgId: string; userId: string; tasks: CadTask[] | null },
): Promise<void> {
  const jobId = await ensureModeRow(client, input.orgId, input.userId);
  await client.query(
    `UPDATE cad_jobs SET tasks=$3::jsonb, updated_at=now() WHERE id=$1::uuid AND org_id=$2::uuid`,
    [jobId, input.orgId, input.tasks ? JSON.stringify(input.tasks) : null],
  );
}

// ---------------------------------------------------------------------------
// Plan steps in cad_job_steps (0016_cad_workspace.sql)
//
// The agent's singleton "CAD agent" cad_jobs row is the job; each proposed tool
// call becomes one cad_job_steps row (operation = tool name, parameters = args +
// rationale + planId). Approval, per-step status, output and error live on
// those rows, so nothing about a plan's outcome is stored twice.
// ---------------------------------------------------------------------------

export function newCadPlanId(): string {
  return randomUUID();
}

type PlanStepRow = {
  sequence: number;
  operation: string;
  parameters: Record<string, unknown> | null;
  status: string;
  approval_status: string;
  output: Record<string, unknown> | null;
  error: string | null;
};

function runStepFromRow(row: PlanStepRow): CadPlanRunStep {
  const parameters = row.parameters ?? {};
  const output = row.output ?? {};
  const narration = output.narration && typeof output.narration === "object" ? (output.narration as { title?: unknown }).title : null;
  const destination = output.destination && typeof output.destination === "object" ? (output.destination as { kind?: unknown; href?: unknown }) : null;
  return {
    sequence: Number(row.sequence),
    index: Number(parameters.planIndex ?? 0),
    tool: row.operation,
    title: typeof parameters.title === "string" ? parameters.title : row.operation,
    status: (CAD_PLAN_STEP_STATUSES as readonly string[]).includes(row.status) ? (row.status as CadPlanStepStatus) : "planned",
    approvalStatus: (CAD_PLAN_APPROVALS as readonly string[]).includes(row.approval_status)
      ? (row.approval_status as CadPlanApproval)
      : "pending",
    featureId: typeof output.featureId === "string" ? output.featureId : typeof output.deletedFeatureId === "string" ? output.deletedFeatureId : null,
    error: row.error ?? null,
    narration: typeof narration === "string" ? narration : null,
    vaultHref: destination?.kind === "vault" && typeof destination.href === "string" ? destination.href : null,
  };
}

export async function loadPlanRun(
  client: PoolClient,
  input: { orgId: string; jobId: string; planId: string },
): Promise<CadPlanRunStep[]> {
  const result = await client.query<PlanStepRow>(
    `SELECT sequence, operation, parameters, status, approval_status, output, error
     FROM cad_job_steps
     WHERE org_id=$1::uuid AND job_id=$2::uuid AND parameters->>'planId'=$3
     ORDER BY sequence`,
    [input.orgId, input.jobId, input.planId],
  );
  return result.rows.map(runStepFromRow);
}

/**
 * Persist a freshly generated plan: the plan JSON on cad_jobs and one
 * cad_job_steps row per tool step. Leftover unapproved rows from an earlier
 * plan are removed first; executed rows are kept as history. Returns the plan
 * with each tool step's `sequence` filled in.
 */
export async function replaceCadPlanSteps(
  client: PoolClient,
  input: { orgId: string; userId: string; plan: CadStoredPlan },
): Promise<CadStoredPlan> {
  const jobId = await ensureModeRow(client, input.orgId, input.userId);
  await client.query(`DELETE FROM cad_job_steps WHERE org_id=$1::uuid AND job_id=$2::uuid AND status='planned'`, [
    input.orgId,
    jobId,
  ]);
  const next = await client.query<{ sequence: number }>(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM cad_job_steps WHERE org_id=$1::uuid AND job_id=$2::uuid`,
    [input.orgId, jobId],
  );
  let sequence = Number(next.rows[0]?.sequence ?? 1);
  const steps: CadPlanStep[] = [];
  for (const step of input.plan.steps) {
    if (!step.tool) {
      steps.push({ ...step, sequence: undefined });
      continue;
    }
    await client.query(
      `INSERT INTO cad_job_steps(org_id, job_id, sequence, operation, idempotency_key, parameters, requires_approval, approval_status, status)
       VALUES($1::uuid, $2::uuid, $3::int, $4, $5, $6::jsonb, true, 'pending', 'planned')`,
      [
        input.orgId,
        jobId,
        sequence,
        step.tool,
        `${jobId}:plan:${input.plan.planId}:${step.index}`,
        JSON.stringify({
          planId: input.plan.planId,
          planIndex: step.index,
          title: step.title,
          rationale: step.detail,
          args: step.args ?? {},
          dryRun: step.dryRun ?? null,
        }),
      ],
    );
    steps.push({ ...step, sequence });
    sequence += 1;
  }
  const plan: CadStoredPlan = { ...input.plan, steps };
  await saveCadAgentPlan(client, { orgId: input.orgId, userId: input.userId, plan });
  await client.query(`UPDATE cad_jobs SET action_plan=$3::jsonb, updated_at=now() WHERE id=$1::uuid AND org_id=$2::uuid`, [
    jobId,
    input.orgId,
    JSON.stringify(plan.steps.map((step) => ({ tool: step.tool ?? null, args: step.args ?? null, title: step.title, sequence: step.sequence ?? null }))),
  ]);
  return plan;
}

/**
 * Drop the current plan. Its steps that never ran — pending review or approved
 * but still waiting — are marked cancelled and kept as history so the run log
 * never shows an approved step as silently "planned" forever. Executed rows
 * are untouched.
 */
export async function discardCadPlan(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<CadAgentModeState> {
  const found = await findModeRow(client, input.orgId, input.userId);
  if (!found) return DEFAULT_CAD_AGENT_MODE_STATE;
  const plan = normalizeStoredPlan(found.row.plan);
  if (plan && plan.planId !== "legacy") {
    await client.query(
      `UPDATE cad_job_steps SET status='cancelled', completed_at=now()
       WHERE org_id=$1::uuid AND job_id=$2::uuid AND parameters->>'planId'=$3 AND status='planned'`,
      [input.orgId, found.jobId, plan.planId],
    );
  }
  await saveCadAgentPlan(client, { orgId: input.orgId, userId: input.userId, plan: null });
  return loadCadAgentModeState(client, input.orgId, input.userId);
}

export type CadPlanDecision = { sequence: number; approved: boolean; args?: Record<string, unknown> };

/**
 * Record the reviewer's decisions. Rejected steps are marked skipped so the
 * executor never touches them; approved steps may carry edited args, which
 * replace the proposed ones (the dry run is recomputed for the record).
 */
export async function approveCadPlanSteps(
  client: PoolClient,
  input: { orgId: string; userId: string; planId: string; decisions: CadPlanDecision[]; answers?: string[] },
): Promise<CadAgentModeState> {
  const found = await findModeRow(client, input.orgId, input.userId);
  if (!found) throw new Error("There is no plan to approve — send a brief in Plan mode first.");
  const plan = normalizeStoredPlan(found.row.plan);
  if (!plan || plan.planId !== input.planId) throw new Error("That plan is no longer current. Reload and review the latest plan.");
  const bySequence = new Map(input.decisions.map((decision) => [decision.sequence, decision]));
  const steps: CadPlanStep[] = [];
  for (const step of plan.steps) {
    const decision = step.sequence ? bySequence.get(step.sequence) : undefined;
    if (!step.tool || !step.sequence || !decision) {
      steps.push(step);
      continue;
    }
    const args = decision.args && typeof decision.args === "object" && !Array.isArray(decision.args) ? decision.args : (step.args ?? {});
    const updated = withPlanDryRun({ ...step, args });
    await client.query(
      `UPDATE cad_job_steps
       SET approval_status=$4, approved_by=$5::uuid, approved_at=now(),
           status=CASE WHEN $6::boolean THEN 'planned' ELSE 'skipped' END,
           parameters=parameters || jsonb_build_object('args', $7::jsonb, 'dryRun', $8::text)
       WHERE org_id=$1::uuid AND job_id=$2::uuid AND sequence=$3::int AND status IN ('planned','skipped')`,
      [
        input.orgId,
        found.jobId,
        step.sequence,
        decision.approved ? "approved" : "rejected",
        input.userId,
        decision.approved,
        JSON.stringify(args),
        updated.dryRun ?? null,
      ],
    );
    steps.push(updated);
  }
  const nextPlan: CadStoredPlan = {
    ...plan,
    steps,
    answers: (input.answers ?? plan.answers).map((answer) => String(answer ?? "")),
    approved: true,
  };
  await saveCadAgentPlan(client, { orgId: input.orgId, userId: input.userId, plan: nextPlan });
  return loadCadAgentModeState(client, input.orgId, input.userId);
}

export type CadPlanStepRecord = {
  jobId: string;
  sequence: number;
  tool: string;
  args: Record<string, unknown>;
  title: string;
  planId: string;
  planIndex: number;
  status: string;
  approvalStatus: string;
};

/** Lock and read one plan step for execution. */
export async function loadCadPlanStepForExecution(
  client: PoolClient,
  input: { orgId: string; userId: string; sequence: number },
): Promise<CadPlanStepRecord> {
  const found = await findModeRow(client, input.orgId, input.userId);
  if (!found) throw new Error("There is no plan to execute.");
  const result = await client.query<PlanStepRow>(
    `SELECT sequence, operation, parameters, status, approval_status, output, error
     FROM cad_job_steps WHERE org_id=$1::uuid AND job_id=$2::uuid AND sequence=$3::int FOR UPDATE`,
    [input.orgId, found.jobId, input.sequence],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Plan step ${input.sequence} does not exist.`);
  const parameters = row.parameters ?? {};
  return {
    jobId: found.jobId,
    sequence: Number(row.sequence),
    tool: row.operation,
    args: asArgs(parameters.args) ?? {},
    title: typeof parameters.title === "string" ? parameters.title : row.operation,
    planId: typeof parameters.planId === "string" ? parameters.planId : "",
    planIndex: Number(parameters.planIndex ?? 0),
    status: row.status,
    approvalStatus: row.approval_status,
  };
}

export async function markCadPlanStep(
  client: PoolClient,
  input: {
    orgId: string;
    jobId: string;
    sequence: number;
    status: "running" | "completed" | "failed";
    output?: unknown;
    error?: string | null;
  },
): Promise<void> {
  if (input.status === "running") {
    await client.query(
      `UPDATE cad_job_steps SET status='running', started_at=now(), progress=10, error=NULL
       WHERE org_id=$1::uuid AND job_id=$2::uuid AND sequence=$3::int`,
      [input.orgId, input.jobId, input.sequence],
    );
    return;
  }
  await client.query(
    `UPDATE cad_job_steps
     SET status=$4, progress=$5::int, output=$6::jsonb, error=$7, completed_at=now()
     WHERE org_id=$1::uuid AND job_id=$2::uuid AND sequence=$3::int`,
    [
      input.orgId,
      input.jobId,
      input.sequence,
      input.status,
      input.status === "completed" ? 100 : 0,
      input.output === undefined ? null : JSON.stringify(input.output),
      input.error ?? null,
    ],
  );
}

/** Feature ids produced so far by this plan, keyed by 1-based plan index, for {{step:N.featureId}}. */
export async function loadCadPlanFeatureIds(
  client: PoolClient,
  input: { orgId: string; jobId: string; planId: string },
): Promise<Map<number, string>> {
  const run = await loadPlanRun(client, input);
  const map = new Map<number, string>();
  for (const step of run) {
    if (step.status === "completed" && step.featureId) map.set(step.index, step.featureId);
  }
  return map;
}
