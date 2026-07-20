/**
 * Persistence helpers for Soft-UI autonomous agent runs.
 * Truncates all text fields to DB CHECK limits — never stores secrets or full HTML.
 */

import type { PoolClient } from "@neondatabase/serverless";

export const MAX_GOAL_CHARS = 4000;
export const MAX_ANSWER_CHARS = 16_000;
export const MAX_SUMMARY_CHARS = 2000;
export const MAX_EXCERPT_CHARS = 8000;
export const MAX_ERROR_CHARS = 2000;
export const DEFAULT_MAX_STEPS = 8;

export type AutonomousRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "setup_required"
  | "cancelled";

export type AutonomousStepKind = "plan" | "tool" | "observe" | "generation" | "error";
export type AutonomousStepStatus = "ok" | "empty" | "setup_required" | "error";

export type AutonomousRunRow = {
  id: string;
  orgId: string;
  userId: string;
  goal: string;
  status: AutonomousRunStatus;
  feature: string;
  requestId: string;
  provider: string | null;
  model: string | null;
  stepCount: number;
  maxSteps: number;
  finalAnswer: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  usageEventIds: string[];
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

export type AutonomousStepRow = {
  id: string;
  orgId: string;
  runId: string;
  sequence: number;
  kind: AutonomousStepKind;
  toolName: string | null;
  argsSummary: string | null;
  resultSummary: string | null;
  resultExcerpt: string | null;
  sourceUrl: string | null;
  status: AutonomousStepStatus;
  requestId: string | null;
  usageEventId: string | null;
  createdAt: string;
};

export function truncateField(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function summarizeJson(value: unknown, max = MAX_SUMMARY_CHARS): string | null {
  try {
    const text = JSON.stringify(value);
    return truncateField(text, max);
  } catch {
    return truncateField(String(value), max);
  }
}

/** Strip anything that looks like a bearer/api key from error text before persist. */
export function sanitizeErrorMessage(message: string): string {
  return truncateField(
    message
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
      .replace(/api[_-]?key[=:]\s*\S+/gi, "api_key=[redacted]")
      .replace(/sk-[A-Za-z0-9]{10,}/g, "[redacted-key]"),
    MAX_ERROR_CHARS,
  )!;
}

export async function insertAutonomousRun(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    goal: string;
    requestId: string;
    maxSteps?: number;
    feature?: string;
    provider?: string | null;
    model?: string | null;
  },
): Promise<string> {
  const goal = truncateField(input.goal, MAX_GOAL_CHARS);
  if (!goal) throw new Error("goal is required");
  const result = await client.query<{ id: string }>(
    `INSERT INTO autonomous_agent_runs(
       org_id, user_id, goal, status, feature, request_id, max_steps, provider, model
     ) VALUES ($1::uuid, $2::uuid, $3, 'running', $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.orgId,
      input.userId,
      goal,
      input.feature ?? "agent",
      input.requestId,
      input.maxSteps ?? DEFAULT_MAX_STEPS,
      input.provider ?? null,
      input.model ?? null,
    ],
  );
  return result.rows[0]!.id;
}

export async function insertAutonomousStep(
  client: PoolClient,
  input: {
    orgId: string;
    runId: string;
    sequence: number;
    kind: AutonomousStepKind;
    toolName?: string | null;
    argsSummary?: string | null;
    resultSummary?: string | null;
    resultExcerpt?: string | null;
    sourceUrl?: string | null;
    status?: AutonomousStepStatus;
    requestId?: string | null;
    usageEventId?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO autonomous_agent_steps(
       org_id, run_id, sequence, kind, tool_name, args_summary, result_summary,
       result_excerpt, source_url, status, request_id, usage_event_id
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid
     )`,
    [
      input.orgId,
      input.runId,
      input.sequence,
      input.kind,
      input.toolName ?? null,
      truncateField(input.argsSummary, MAX_SUMMARY_CHARS),
      truncateField(input.resultSummary, MAX_SUMMARY_CHARS),
      truncateField(input.resultExcerpt, MAX_EXCERPT_CHARS),
      truncateField(input.sourceUrl, 2000),
      input.status ?? "ok",
      input.requestId ?? null,
      input.usageEventId ?? null,
    ],
  );
}

export async function finishAutonomousRun(
  client: PoolClient,
  input: {
    runId: string;
    status: AutonomousRunStatus;
    stepCount: number;
    finalAnswer?: string | null;
    errorClass?: string | null;
    errorMessage?: string | null;
    provider?: string | null;
    model?: string | null;
    usageEventIds?: string[];
  },
): Promise<void> {
  await client.query(
    `UPDATE autonomous_agent_runs SET
       status = $2,
       step_count = $3,
       final_answer = $4,
       error_class = $5,
       error_message = $6,
       provider = COALESCE($7, provider),
       model = COALESCE($8, model),
       usage_event_ids = COALESCE($9::jsonb, usage_event_ids),
       finished_at = now()
     WHERE id = $1::uuid`,
    [
      input.runId,
      input.status,
      input.stepCount,
      truncateField(input.finalAnswer, MAX_ANSWER_CHARS),
      input.errorClass ?? null,
      input.errorMessage ? sanitizeErrorMessage(input.errorMessage) : null,
      input.provider ?? null,
      input.model ?? null,
      input.usageEventIds ? JSON.stringify(input.usageEventIds) : null,
    ],
  );
}

export async function listAutonomousRuns(
  client: PoolClient,
  orgId: string,
  limit = 20,
): Promise<AutonomousRunRow[]> {
  try {
    const result = await client.query<{
      id: string;
      orgId: string;
      userId: string;
      goal: string;
      status: AutonomousRunStatus;
      feature: string;
      requestId: string;
      provider: string | null;
      model: string | null;
      stepCount: number;
      maxSteps: number;
      finalAnswer: string | null;
      errorClass: string | null;
      errorMessage: string | null;
      usageEventIds: string[] | null;
      startedAt: string;
      finishedAt: string | null;
      createdAt: string;
    }>(
      `SELECT id, org_id AS "orgId", user_id AS "userId", goal, status, feature,
              request_id AS "requestId", provider, model,
              step_count AS "stepCount", max_steps AS "maxSteps",
              final_answer AS "finalAnswer", error_class AS "errorClass",
              error_message AS "errorMessage",
              usage_event_ids AS "usageEventIds",
              started_at AS "startedAt", finished_at AS "finishedAt",
              created_at AS "createdAt"
         FROM autonomous_agent_runs
        WHERE org_id = $1::uuid
        ORDER BY started_at DESC
        LIMIT $2`,
      [orgId, Math.min(Math.max(limit, 1), 50)],
    );
    return result.rows.map((row) => ({
      ...row,
      usageEventIds: Array.isArray(row.usageEventIds) ? row.usageEventIds : [],
    }));
  } catch {
    // Table not migrated yet — Soft-UI shows empty/setup, never DEMO runs.
    return [];
  }
}

export async function getAutonomousRunWithSteps(
  client: PoolClient,
  orgId: string,
  runId: string,
): Promise<{ run: AutonomousRunRow; steps: AutonomousStepRow[] } | null> {
  try {
    const runResult = await client.query<AutonomousRunRow>(
      `SELECT id, org_id AS "orgId", user_id AS "userId", goal, status, feature,
              request_id AS "requestId", provider, model,
              step_count AS "stepCount", max_steps AS "maxSteps",
              final_answer AS "finalAnswer", error_class AS "errorClass",
              error_message AS "errorMessage",
              COALESCE(usage_event_ids, '[]'::jsonb) AS "usageEventIds",
              started_at AS "startedAt", finished_at AS "finishedAt",
              created_at AS "createdAt"
         FROM autonomous_agent_runs
        WHERE id = $1::uuid AND org_id = $2::uuid`,
      [runId, orgId],
    );
    const run = runResult.rows[0];
    if (!run) return null;
    const steps = await client.query<AutonomousStepRow>(
      `SELECT id, org_id AS "orgId", run_id AS "runId", sequence, kind,
              tool_name AS "toolName", args_summary AS "argsSummary",
              result_summary AS "resultSummary", result_excerpt AS "resultExcerpt",
              source_url AS "sourceUrl", status,
              request_id AS "requestId", usage_event_id AS "usageEventId",
              created_at AS "createdAt"
         FROM autonomous_agent_steps
        WHERE run_id = $1::uuid AND org_id = $2::uuid
        ORDER BY sequence ASC`,
      [runId, orgId],
    );
    return {
      run: {
        ...run,
        usageEventIds: Array.isArray(run.usageEventIds) ? run.usageEventIds : [],
      },
      steps: steps.rows,
    };
  } catch {
    return null;
  }
}
