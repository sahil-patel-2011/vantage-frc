import type { PoolClient } from "@neondatabase/serverless";
import {
  CAD_MULTITASK_DECOMPOSE_INSTRUCTIONS,
  CAD_PLAN_MODE_INSTRUCTIONS,
  cadAgentStep,
  cadMultitaskExecutionPreamble,
  cadPlanExecutionPreamble,
  callClaudeCadTool,
  isWebCadAgentTool,
  parseCadAgentAction,
  parseCadPlanResponse,
  parseCadTasksResponse,
  resolvePlanStepReferences,
  shouldProposeModeSwitch,
  summarizeCadAgentSteps,
  WEB_CAD_AGENT_INSTRUCTIONS,
  WEB_CAD_AGENT_MAX_STEPS,
  type CadAgentMode,
  type CadAgentStep,
  type ClaudeCadRuntime,
  type ClaudeCadSession,
} from "@vantage/cad";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter, type ContextItem } from "@vantage/agent";
import { createBridgeTransport } from "../ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { saveExportToCadVault } from "../cad-vault/store-version";
import {
  loadCadAgentModeState,
  loadCadPlanFeatureIds,
  loadCadPlanStepForExecution,
  loadPlanRun,
  markCadPlanStep,
  newCadPlanId,
  proposeCadAgentMode,
  replaceCadPlanSteps,
  saveCadAgentPlan,
  saveCadAgentTasks,
  type CadAgentModeState,
  type CadPlanRunStep,
  type CadStoredPlan,
} from "./agent-mode-session";
import {
  cadAgentOpenUrl,
  loadCadAgentSession,
  saveCadAgentSession,
  type CadAgentChatMessage,
  type CadAgentSessionRow,
} from "./cad-agent-session";
import { loadCadAgentOnshape, type CadAgentOnshapeClient } from "./onshape-tokens";

function clip(value: unknown, max = 1800): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The hosted tool runtime: org OAuth (or team / env) HTTP, the DB-backed
 * session, and the CAD vault as the export sink. Shared by the chat loop and
 * plan-step execution so both persist features and exports the same way.
 */
function createHostedCadRuntime(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  onshape: CadAgentOnshapeClient;
  stored: CadAgentSessionRow | null;
}): { runtime: ClaudeCadRuntime; current: () => { session: ClaudeCadSession; stored: CadAgentSessionRow | null } } {
  let stored = input.stored;
  let session: ClaudeCadSession = stored?.session ?? {};
  const runtime: ClaudeCadRuntime = {
    http: input.onshape.http,
    hosted: true,
    loadSession: async () => session,
    saveSession: async (next) => {
      session = next;
      stored = await saveCadAgentSession(input.client, {
        orgId: input.orgId,
        userId: input.userId,
        connectionId: input.onshape.connectionId,
        session: next,
        url: stored?.url,
        messages: stored?.messages,
      });
    },
    saveExport: async ({ file, title, changeNote, document }) => {
      const saved = await saveExportToCadVault(input.client, {
        orgId: input.orgId,
        userId: input.userId,
        title,
        filename: file.filename,
        bytes: file.bytes,
        changeNote: changeNote ?? `Exported ${file.format.toUpperCase()} from Onshape by the CAD agent`,
        externalUrl: cadAgentOpenUrl(document) ?? null,
      });
      return {
        kind: "vault",
        documentId: saved.documentId,
        version: saved.version,
        href: saved.href,
        duplicate: saved.duplicate,
        title: saved.title,
      };
    },
  };
  return { runtime, current: () => ({ session, stored }) };
}

export type CadPlanResponseInput = {
  approve: boolean;
  answers?: string[];
  steps?: Array<{ title: string; detail?: string }>;
};

export type CadAgentTurnResult = {
  text: string;
  tools: Array<{ name: string; ok: boolean }>;
  /**
   * Narrated build steps for the /cad session pane, in execution order. Built from
   * each tool's own `narration` — see packages/cad/src/cad-agent-steps.ts.
   */
  steps: CadAgentStep[];
  messages: CadAgentChatMessage[];
  modeState: CadAgentModeState;
  /** Set when the turn was held for a consent-gated mode-switch proposal (no AI ran). */
  proposal: { mode: CadAgentMode; reasons: string[]; expiresAt: string } | null;
};

/**
 * Plan-mode team context, assembled from REAL data only: the bound document and
 * element names already in the session, plus the org's robot subsystems spec
 * sheet when that table has rows. Nothing is fabricated when data is absent.
 */
async function loadPlanTeamContext(client: PoolClient, orgId: string, session: ClaudeCadSession): Promise<string> {
  const facts: string[] = [];
  if (session.documentName) facts.push(`Bound Onshape document/element: ${session.documentName}`);
  if (session.documentId) facts.push(`Bound Part Studio ids: document ${session.documentId}, element ${session.elementId ?? "?"}`);
  try {
    // to_regclass returns NULL (no error) when the table does not exist, which
    // keeps the surrounding transaction healthy on older databases.
    const reg = await client.query<{ ok: string | null }>(`SELECT to_regclass('public.robot_subsystems')::text AS ok`);
    if (reg.rows[0]?.ok) {
      const rows = await client.query<{ name: string; category: string; motor_type: string }>(
        `SELECT name, category, motor_type FROM robot_subsystems
         WHERE org_id=$1::uuid ORDER BY updated_at DESC LIMIT 12`,
        [orgId],
      );
      if (rows.rows.length) {
        facts.push(
          `Team subsystems: ${rows.rows
            .map((row) => `${row.name} (${row.category}${row.motor_type ? `, ${row.motor_type}` : ""})`)
            .join("; ")}`,
        );
      }
    }
  } catch {
    // Subsystems context is optional — skip silently rather than fail planning.
  }
  return facts.length ? facts.join("\n") : "No team context on file — plan from the brief alone.";
}

export async function runCadAgentTurn(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  requestId: string;
  message: string;
  /** false after a proposal was answered, so one request is never asked twice. */
  allowProposal?: boolean;
  planResponse?: CadPlanResponseInput | null;
}): Promise<CadAgentTurnResult> {
  const onshape = await loadCadAgentOnshape(input.client, input.orgId, input.userId);
  const initial = await loadCadAgentSession(input.client, input.orgId, input.userId);
  const hosted = createHostedCadRuntime({ client: input.client, orgId: input.orgId, userId: input.userId, onshape, stored: initial });
  const runtime = hosted.runtime;
  // `session` / `stored` track the runtime's persisted state as tools run.
  let session: ClaudeCadSession = hosted.current().session;
  let stored: CadAgentSessionRow | null = hosted.current().stored;
  const sync = () => {
    session = hosted.current().session;
    stored = hosted.current().stored;
  };

  let modeState = await loadCadAgentModeState(input.client, input.orgId, input.userId);
  const history = (stored?.messages ?? []).slice(-8);

  const executingPlan = Boolean(
    input.planResponse?.approve && modeState.mode === "plan" && modeState.plan && !modeState.plan.approved,
  );
  if (executingPlan && modeState.plan?.steps.some((step) => step.tool)) {
    // Tool-call plans are approved and executed step by step through
    // approve-plan / execute-plan-step, never by handing the plan back to the model.
    throw new Error("This plan is made of reviewable tool calls — approve the steps you want and they run one at a time.");
  }

  // Consent-gated mode-switch proposal: heuristics only, no AI call. The turn is
  // held; the client re-submits via propose-response and the server enforces the
  // 15-second expiry (an old proposal counts as declined).
  if (input.allowProposal !== false && !executingPlan && !modeState.proposal && input.message.trim()) {
    const { proposedMode, reasons } = shouldProposeModeSwitch(modeState.mode, input.message);
    if (proposedMode) {
      modeState = await proposeCadAgentMode(input.client, {
        orgId: input.orgId,
        userId: input.userId,
        mode: proposedMode,
      });
      if (modeState.proposal) {
        return {
          text: "",
          tools: [],
          steps: stored?.steps ?? [],
          messages: stored?.messages ?? [],
          modeState,
          proposal: { mode: modeState.proposal.mode, reasons, expiresAt: modeState.proposal.expiresAt },
        };
      }
    }
  }

  const promptCachingEnabled = await getOrgPromptCachingEnabled(input.client, input.orgId);
  const adapter = await resolveOrgChatAdapter(input.client, {
    orgId: input.orgId,
    userId: input.userId,
    promptCachingEnabled,
    feature: "cad",
    bridgeTransport: createBridgeTransport(),
  });

  const boundDocumentItem: ContextItem = {
    type: "module_fact",
    id: "cad-bound-document",
    content: JSON.stringify({
      bound: session.documentId
        ? {
            documentId: session.documentId,
            workspaceId: session.workspaceId,
            elementId: session.elementId,
            documentName: session.documentName ?? null,
          }
        : null,
      via: onshape.via,
    }),
    importance: 700,
  };
  const historyItems: ContextItem[] = history.map((item, index) => ({
    type: "module_fact" as const,
    id: `cad-history-${index}`,
    content: `${item.role}: ${item.text}`,
    importance: 200,
  }));

  async function aiComplete(stepKey: string, message: string, context: ContextItem[], usageTag: string): Promise<string> {
    const text = await meteredAI({
      client: input.client,
      orgId: input.orgId,
      userId: input.userId,
      feature: "cad",
      requestId: `${input.requestId}:${stepKey}`,
      estimatedCostUsd: 0.01,
      estimatedPromptTokens: Math.ceil(message.length / 4) + 400,
      estimatedCompletionTokens: 500,
      provider: adapter.provider,
      model: adapter.model,
      billingOwner: { type: "org", id: input.orgId },
      metadata: { usageTag, promptCachingEnabled, step: stepKey },
      invoke: async () => {
        const result = await adapter.complete({ message, context, promptCachingEnabled });
        return { value: result.text, ...result, provider: adapter.provider, model: adapter.model };
      },
    });
    return String(text);
  }

  const toolTrace: Array<{ name: string; ok: boolean }> = [];
  // Narrated steps for the session pane. Every tool call appends exactly one,
  // including failures, so the pane never shows a shorter story than what ran.
  const narratedSteps: CadAgentStep[] = [];
  const toolResultItems: ContextItem[] = [];
  let stepsUsed = 0;

  /** The Claude-CodeCad tool loop, shared by every mode. Returns the final reply ("" if the budget ran out). */
  async function runToolLoop(brief: string, extraItems: ContextItem[], maxSteps: number, usageTag: string): Promise<string> {
    let reply = "";
    for (let hop = 0; hop < maxSteps; hop++) {
      const step = stepsUsed++;
      const context: ContextItem[] = [
        { type: "module_fact", id: "cad-agent-instructions", content: WEB_CAD_AGENT_INSTRUCTIONS, importance: 900 },
        boundDocumentItem,
        ...extraItems,
        ...historyItems,
        ...toolResultItems,
      ];
      const text = await aiComplete(
        `step:${step}`,
        hop === 0
          ? `${WEB_CAD_AGENT_INSTRUCTIONS}\n\nUser brief:\n${brief}`
          : "Continue the CAD job. Prior tool results are in context. Reply with one JSON hop.",
        context,
        usageTag,
      );
      const action = parseCadAgentAction(text);
      if (!action || action.type === "final") {
        reply = action?.type === "final" ? action.answer : text.trim();
        break;
      }
      if (!isWebCadAgentTool(action.tool)) {
        reply = `The model asked for "${action.tool}", which this hosted agent does not run. Bind Onshape and use sketch/extrude.`;
        break;
      }
      let result: unknown;
      let ok = true;
      try {
        result = await callClaudeCadTool(action.tool, action.input, runtime);
      } catch (error) {
        ok = false;
        result = { ok: false, error: error instanceof Error ? error.message : "CAD tool failed" };
      }
      sync();
      toolTrace.push({ name: action.tool, ok });
      narratedSteps.push(
        cadAgentStep({ index: narratedSteps.length + 1, tool: action.tool, result, ok }),
      );
      toolResultItems.push({
        type: "module_fact",
        id: `cad-tool-${step}-${action.tool}`,
        content: JSON.stringify({ tool: action.tool, ok, result: clip(result) }),
        importance: 600,
      });
    }
    return reply;
  }

  async function finishTurn(userText: string, reply: string): Promise<CadAgentTurnResult> {
    const finalReply =
      reply ||
      (toolTrace.length
        ? "The agent ran CAD tools but did not return a final message. Check the Onshape viewport."
        : "The model did not return a CAD action. Bind a Part Studio and try a millimetre brief.");
    const nextMessages: CadAgentChatMessage[] = [
      ...history,
      { role: "user" as const, text: userText },
      {
        role: "assistant" as const,
        // The transcript now points at the step list instead of repeating raw tool
        // names — the pane above carries the narrated version with real dimensions.
        text: narratedSteps.length ? `${finalReply}\n\n${summarizeCadAgentSteps(narratedSteps)}` : finalReply,
      },
    ].slice(-24);
    // A turn that ran no tools keeps the previous steps on screen (plan drafting,
    // a clarifying question); a turn that built something replaces them.
    const steps = narratedSteps.length ? narratedSteps : (stored?.steps ?? []);
    stored = await saveCadAgentSession(input.client, {
      orgId: input.orgId,
      userId: input.userId,
      connectionId: onshape.connectionId,
      session,
      url: stored?.url,
      messages: nextMessages,
      steps,
    });
    return {
      text: finalReply,
      tools: toolTrace,
      steps,
      messages: nextMessages,
      modeState: await loadCadAgentModeState(input.client, input.orgId, input.userId),
      proposal: null,
    };
  }

  if (!executingPlan && !input.message.trim()) {
    return {
      text: "There is no pending plan to build — send a brief first.",
      tools: [],
      steps: stored?.steps ?? [],
      messages: stored?.messages ?? [],
      modeState,
      proposal: null,
    };
  }

  // ---- Plan mode: execute an approved plan --------------------------------
  if (executingPlan && modeState.plan) {
    const editedSteps = (input.planResponse?.steps ?? [])
      .map((step, index) => ({
        index: index + 1,
        title: typeof step.title === "string" ? step.title.trim() : "",
        detail: typeof step.detail === "string" ? step.detail.trim() : "",
      }))
      .filter((step) => step.title);
    const plan: CadStoredPlan = {
      ...modeState.plan,
      steps: editedSteps.length ? editedSteps : modeState.plan.steps,
      answers: (input.planResponse?.answers ?? modeState.plan.answers).map((answer) => String(answer ?? "")),
      approved: true,
    };
    await saveCadAgentPlan(input.client, { orgId: input.orgId, userId: input.userId, plan });
    const preamble = cadPlanExecutionPreamble({ steps: plan.steps, questions: plan.questions, answers: plan.answers });
    const brief = `${preamble}\n\nOriginal brief:\n${plan.brief || input.message}`;
    const reply = await runToolLoop(
      brief,
      [{ type: "module_fact", id: "cad-plan-execution", content: preamble, importance: 850 }],
      WEB_CAD_AGENT_MAX_STEPS,
      "cad.agent.plan",
    );
    return finishTurn(input.message.trim() || "Approved the build plan — execute it.", reply);
  }

  // ---- Plan mode: produce/revise the plan (no tool calls) -----------------
  if (modeState.mode === "plan") {
    const teamContext = await loadPlanTeamContext(input.client, input.orgId, session);
    const priorPlan = modeState.plan && !modeState.plan.approved ? modeState.plan : null;
    const planPrompt = [
      CAD_PLAN_MODE_INSTRUCTIONS,
      `Team context (real data only):\n${teamContext}`,
      priorPlan
        ? `The user is revising this draft plan:\n${JSON.stringify({ steps: priorPlan.steps, questions: priorPlan.questions })}`
        : "",
      `User brief:\n${priorPlan ? `${priorPlan.brief}\n\nRevision request:\n` : ""}${input.message}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const text = await aiComplete("plan", planPrompt, [boundDocumentItem, ...historyItems], "cad.agent.plan");
    const parsed = parseCadPlanResponse(text);
    if (!parsed) {
      // Honest fallback: surface the model's own words (often a question) rather than inventing a plan.
      return finishTurn(input.message, text.trim() || "The model did not return a plan. Try restating the brief in millimetres.");
    }
    const draft: CadStoredPlan = {
      planId: newCadPlanId(),
      brief: priorPlan ? `${priorPlan.brief}\n${input.message}` : input.message,
      steps: parsed.steps,
      questions: parsed.questions,
      answers: [],
      approved: false,
    };
    // Tool steps become cad_job_steps rows (pending approval); narrative-only
    // steps stay in the plan JSON. Nothing has touched Onshape.
    const plan = await replaceCadPlanSteps(input.client, { orgId: input.orgId, userId: input.userId, plan: draft });
    const toolSteps = plan.steps.filter((step) => step.tool).length;
    const summary = [
      `Here is the build plan (${plan.steps.length} steps${toolSteps ? `, ${toolSteps} tool call${toolSteps === 1 ? "" : "s"}` : ""}${plan.questions.length ? `, ${plan.questions.length} open question${plan.questions.length === 1 ? "" : "s"}` : ""}). Review each step's dry run, untick anything you do not want, then Approve. No Onshape tools ran yet.`,
      ...plan.steps.map((step) => `${step.index}. ${step.dryRun ?? step.title}${step.detail ? ` — ${step.detail}` : ""}`),
    ].join("\n");
    return finishTurn(input.message, summary);
  }

  // ---- Multitask mode: decompose, then work the checklist sequentially ----
  if (modeState.mode === "multitask") {
    const decomposePrompt = `${CAD_MULTITASK_DECOMPOSE_INSTRUCTIONS}\n\nUser brief:\n${input.message}`;
    const decomposeText = await aiComplete("decompose", decomposePrompt, [boundDocumentItem, ...historyItems], "cad.agent.multitask");
    const tasks = parseCadTasksResponse(decomposeText);
    if (!tasks) {
      return finishTurn(
        input.message,
        decomposeText.trim() || "The model did not return a sub-task list. Try restating the brief in millimetres.",
      );
    }
    await saveCadAgentTasks(input.client, { orgId: input.orgId, userId: input.userId, tasks });

    const summaries: string[] = [];
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index]!;
      if (stepsUsed >= WEB_CAD_AGENT_MAX_STEPS) {
        task.note = "Not started — this turn's step budget ran out. Send another message to continue.";
        continue;
      }
      task.status = "in_progress";
      await saveCadAgentTasks(input.client, { orgId: input.orgId, userId: input.userId, tasks });
      const before = toolTrace.length;
      const preamble = cadMultitaskExecutionPreamble(task, index + 1, tasks.length);
      const reply = await runToolLoop(
        `${preamble}\n\nFull brief:\n${input.message}`,
        [{ type: "module_fact", id: `cad-task-${task.id}`, content: preamble, importance: 850 }],
        WEB_CAD_AGENT_MAX_STEPS - stepsUsed,
        "cad.agent.multitask",
      );
      const failedTools = toolTrace.slice(before).some((t) => !t.ok);
      if (!reply) {
        task.note = "Step budget ran out mid-task. Send another message to continue.";
      } else {
        task.status = failedTools ? "failed" : "done";
        task.note = clip(reply, 400);
        summaries.push(`${task.title}: ${reply}`);
      }
      await saveCadAgentTasks(input.client, { orgId: input.orgId, userId: input.userId, tasks });
    }
    const done = tasks.filter((t) => t.status === "done").length;
    const overall = [
      `Worked the checklist sequentially through one Onshape session — ${done}/${tasks.length} sub-tasks done.`,
      ...tasks.map((t) => `[${t.status}] ${t.title}${t.note ? ` — ${clip(t.note, 200)}` : ""}`),
    ].join("\n");
    return finishTurn(input.message, overall);
  }

  // ---- Simple mode: the original single-request loop ----------------------
  const reply = await runToolLoop(input.message, [], WEB_CAD_AGENT_MAX_STEPS, "cad.agent");
  return finishTurn(input.message, reply);
}

// ---------------------------------------------------------------------------
// Plan execution: one approved tool step per call, no model in the loop
// ---------------------------------------------------------------------------

export type CadPlanStepExecution = {
  step: CadPlanRunStep;
  /** True when no approved step of this plan is still waiting to run. */
  done: boolean;
  steps: CadAgentStep[];
  messages: CadAgentChatMessage[];
  modeState: CadAgentModeState;
};

const MAX_STEP_OUTPUT_CHARS = 20_000;

function stepOutputForStorage(result: unknown): unknown {
  const text = JSON.stringify(result ?? null);
  if (text.length <= MAX_STEP_OUTPUT_CHARS) return result;
  const record = (result ?? {}) as Record<string, unknown>;
  return {
    truncated: true,
    featureId: record.featureId ?? null,
    narration: record.narration ?? null,
    destination: record.destination ?? null,
  };
}

/**
 * Execute exactly one approved step of the current plan through the ordinary
 * tool executor. `{{step:N.featureId}}` references are resolved from the plan's
 * completed steps; a failed resolution is recorded as a failed step, never run
 * against a guessed id. The narrated build log and the transcript are updated
 * so a reload shows the same story as the live run.
 */
export async function executeCadPlanStep(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  sequence: number;
}): Promise<CadPlanStepExecution> {
  const record = await loadCadPlanStepForExecution(input.client, {
    orgId: input.orgId,
    userId: input.userId,
    sequence: input.sequence,
  });
  if (record.approvalStatus !== "approved") {
    throw new Error(`Step ${record.planIndex || record.sequence} (${record.tool}) was not approved, so it will not run.`);
  }
  if (record.status === "running") throw new Error(`Step ${record.planIndex} is already running.`);

  const onshape = await loadCadAgentOnshape(input.client, input.orgId, input.userId);
  const initial = await loadCadAgentSession(input.client, input.orgId, input.userId);
  const hosted = createHostedCadRuntime({ client: input.client, orgId: input.orgId, userId: input.userId, onshape, stored: initial });

  const priorRun = await loadPlanRun(input.client, { orgId: input.orgId, jobId: record.jobId, planId: record.planId });
  const alreadyRan = priorRun.some((step) => step.status === "completed" || step.status === "failed");
  // A new plan run replaces the previous build log, like a chat turn that built something.
  const baseSteps: CadAgentStep[] = alreadyRan ? (initial?.steps ?? []) : [];

  let result: unknown;
  let ok = true;
  if (record.status === "completed") {
    // Idempotent re-request (double click, retry after a dropped response): report, do not re-run.
    const existing = priorRun.find((step) => step.sequence === record.sequence)!;
    return {
      step: existing,
      done: !priorRun.some((step) => step.approvalStatus === "approved" && step.status === "planned"),
      steps: initial?.steps ?? [],
      messages: initial?.messages ?? [],
      modeState: await loadCadAgentModeState(input.client, input.orgId, input.userId),
    };
  }
  if (!isWebCadAgentTool(record.tool)) {
    ok = false;
    result = { ok: false, error: `"${record.tool}" is not a tool the hosted agent can run.` };
  } else {
    let args: Record<string, unknown> | null = null;
    try {
      const featureIds = await loadCadPlanFeatureIds(input.client, { orgId: input.orgId, jobId: record.jobId, planId: record.planId });
      args = resolvePlanStepReferences(record.args, featureIds);
    } catch (error) {
      ok = false;
      result = { ok: false, error: error instanceof Error ? error.message : "Could not resolve step references" };
    }
    if (args) {
      await markCadPlanStep(input.client, { orgId: input.orgId, jobId: record.jobId, sequence: record.sequence, status: "running" });
      try {
        result = await callClaudeCadTool(record.tool, args, hosted.runtime);
      } catch (error) {
        ok = false;
        result = { ok: false, error: error instanceof Error ? error.message : "CAD tool failed" };
      }
    }
  }
  const bodyOk = ok && !(result && typeof result === "object" && (result as { ok?: unknown }).ok === false);
  const errorText = bodyOk ? null : String((result as { error?: unknown } | null)?.error ?? "The tool failed and nothing was changed.");
  await markCadPlanStep(input.client, {
    orgId: input.orgId,
    jobId: record.jobId,
    sequence: record.sequence,
    status: bodyOk ? "completed" : "failed",
    output: stepOutputForStorage(result),
    error: errorText,
  });

  const narrated = cadAgentStep({ index: baseSteps.length + 1, tool: record.tool, result, ok });
  const steps = [...baseSteps, narrated].slice(-40).map((step, index) => ({ ...step, index: index + 1 }));

  const run = await loadPlanRun(input.client, { orgId: input.orgId, jobId: record.jobId, planId: record.planId });
  const remaining = run.filter((step) => step.approvalStatus === "approved" && step.status === "planned");
  const done = remaining.length === 0;
  const current = hosted.current();
  let messages = current.stored?.messages ?? initial?.messages ?? [];
  if (done) {
    const completed = run.filter((step) => step.status === "completed").length;
    const failed = run.filter((step) => step.status === "failed").length;
    const skipped = run.filter((step) => step.status === "skipped").length;
    const text = [
      `Plan run finished — ${completed} step${completed === 1 ? "" : "s"} built${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped` : ""}.`,
      summarizeCadAgentSteps(steps),
    ]
      .filter(Boolean)
      .join(" ");
    messages = [...messages, { role: "assistant" as const, text }].slice(-24);
  }
  await saveCadAgentSession(input.client, {
    orgId: input.orgId,
    userId: input.userId,
    connectionId: onshape.connectionId,
    session: current.session,
    url: current.stored?.url ?? initial?.url,
    messages,
    steps,
  });
  const step = run.find((item) => item.sequence === record.sequence)!;
  return {
    step,
    done,
    steps,
    messages,
    modeState: await loadCadAgentModeState(input.client, input.orgId, input.userId),
  };
}
