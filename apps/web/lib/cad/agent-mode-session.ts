import type { PoolClient } from "@neondatabase/serverless";
import {
  CAD_MODE_PROPOSAL_TTL_MS,
  isCadAgentMode,
  isModeProposalExpired,
  normalizeCadTasks,
  type CadAgentMode,
  type CadPlanStep,
  type CadTask,
} from "@vantage/cad";
import { CAD_AGENT_JOB_TITLE, saveCadAgentSession } from "./cad-agent-session";

export type CadStoredPlan = {
  brief: string;
  steps: CadPlanStep[];
  questions: string[];
  answers: string[];
  approved: boolean;
};

export type CadAgentModeState = {
  mode: CadAgentMode;
  proposal: { mode: CadAgentMode; proposedAt: string; expiresAt: string } | null;
  plan: CadStoredPlan | null;
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
  tasks: null,
};

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
    steps.push({
      index: steps.length + 1,
      title,
      detail: typeof step.detail === "string" ? step.detail : "",
    });
  }
  if (!steps.length) return null;
  const questions = Array.isArray(record.questions)
    ? record.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 10)
    : [];
  const answers = Array.isArray(record.answers)
    ? record.answers.map((a) => (typeof a === "string" ? a : "")).slice(0, questions.length || 10)
    : [];
  return {
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
export function modeStateFromRow(row: CadAgentModeRow | null | undefined, now: number = Date.now()): CadAgentModeState {
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
  return {
    mode,
    proposal,
    plan: normalizeStoredPlan(row.plan),
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
  return modeStateFromRow(found?.row ?? null, now);
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
