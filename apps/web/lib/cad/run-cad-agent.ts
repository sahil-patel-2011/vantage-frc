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
import {
  loadCadAgentModeState,
  proposeCadAgentMode,
  saveCadAgentPlan,
  saveCadAgentTasks,
  type CadAgentModeState,
  type CadStoredPlan,
} from "./agent-mode-session";
import { loadCadAgentSession, saveCadAgentSession, type CadAgentChatMessage } from "./cad-agent-session";
import { loadCadAgentOnshape } from "./onshape-tokens";

function clip(value: unknown, max = 1800): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
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
  let stored = await loadCadAgentSession(input.client, input.orgId, input.userId);
  let session: ClaudeCadSession = stored?.session ?? {};
  const runtime: ClaudeCadRuntime = {
    http: onshape.http,
    hosted: true,
    loadSession: async () => session,
    saveSession: async (next) => {
      session = next;
      stored = await saveCadAgentSession(input.client, {
        orgId: input.orgId,
        userId: input.userId,
        connectionId: onshape.connectionId,
        session: next,
        url: stored?.url,
        messages: stored?.messages,
      });
    },
  };

  let modeState = await loadCadAgentModeState(input.client, input.orgId, input.userId);
  const history = (stored?.messages ?? []).slice(-8);

  const executingPlan = Boolean(
    input.planResponse?.approve && modeState.mode === "plan" && modeState.plan && !modeState.plan.approved,
  );

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
    const plan: CadStoredPlan = {
      brief: priorPlan ? `${priorPlan.brief}\n${input.message}` : input.message,
      steps: parsed.steps,
      questions: parsed.questions,
      answers: [],
      approved: false,
    };
    await saveCadAgentPlan(input.client, { orgId: input.orgId, userId: input.userId, plan });
    const summary = [
      `Here is the build plan (${plan.steps.length} steps${plan.questions.length ? `, ${plan.questions.length} open questions` : ""}). Review it, answer the questions, then Approve & build. No Onshape tools ran yet.`,
      ...plan.steps.map((step) => `${step.index}. ${step.title}${step.detail ? ` — ${step.detail}` : ""}`),
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
