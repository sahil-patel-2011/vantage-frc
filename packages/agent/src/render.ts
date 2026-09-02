/**
 * renderWithModel — the one honest path for "AI-led" feature output.
 *
 * Every feature that used to route a deterministic template through meteredAI with
 * keySource 'local_cli' (cost 0, tokens 0, provider 'vantage-local') now calls this:
 * it resolves the org's real adapter exactly like chat does, meters the call with a real
 * cost estimate under the feature's own name, and on ANY failure — no key, cap hit,
 * approval required, timeout, provider error, empty or malformed output — returns the
 * deterministic template with a `fallbackReason`. Either way it records a row in
 * ai_render_attempts so governance can show, per feature, how often a model actually
 * produced the output versus the template standing in.
 *
 * The result's `mode` must reach the API response and the UI: a template result is
 * labelled "Template", never "AI".
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { classifyMeteredAiError, meteredAI, type MeteredAIInput } from "@vantage/billing";
import type { ChatAdapter, ContextItem } from "./index";
import { estimateCostUsd } from "./cost-estimate";
import {
  ChatProviderResolutionError,
  resolveOrgChatAdapterWithProvenance,
  type ResolveOrgChatAdapterInput,
  type ResolvedOrgChatAdapter,
} from "./resolve-chat-adapter";
import type { SubscriptionBridgeTransport } from "./subscription-bridge-adapter";

export type RenderMode = "model" | "template";

export type RenderFallbackReason =
  | "no_provider"
  | "billing_not_configured"
  | "cap_hit"
  | "approval_required"
  | "policy_denied"
  | "timeout"
  | "provider_error"
  | "empty_output"
  | "rejected_output"
  | "resolve_error";

/** What a feature reports up to its route and UI about how the output was produced. */
export type RenderOutcome = {
  mode: RenderMode;
  /** meteredAI feature name (= ai_render_attempts.feature) so a UI badge can label itself from the outcome alone. */
  feature?: string;
  modelId?: string;
  provider?: string;
  /** Set only when mode === 'template'. May carry a suffix, e.g. "cap_hit:payg_not_enabled". */
  fallbackReason?: string;
  requestId: string;
};

export type RenderWithModelResult = RenderOutcome & {
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export type RenderWithModelInput = {
  /** meteredAI feature name — also the ai_render_attempts.feature value. */
  feature: string;
  orgId: string;
  userId: string;
  /** The request's withRls client. */
  client: PoolClient;
  /** Compact serialization of the same inputs the template uses + structure instructions. */
  prompt: string;
  /** Extra system-level framing (sent as the first context block). */
  system?: string;
  context?: ContextItem[];
  /** The deterministic fallback. Called lazily, only when the model path did not produce output. */
  template: () => string;
  /** Completion budget used for the pre-call cost estimate (default 700). */
  maxTokens?: number;
  /** Reject model output that does not keep the template's structure — falls back with rejected_output. */
  accept?: (text: string) => boolean;
  requestId?: string;
  metadata?: Record<string, unknown>;
  promptCachingEnabled?: boolean;
  /** apps/web passes createBridgeTransport() so a covering paired device can serve the render. */
  bridgeTransport?: SubscriptionBridgeTransport;
  /** Injected for tests. */
  resolveAdapter?: (
    client: PoolClient,
    input: ResolveOrgChatAdapterInput,
  ) => Promise<ResolvedOrgChatAdapter>;
  metered?: <T>(input: MeteredAIInput<T>) => Promise<T>;
  /** Default true. Tests that assert on the meter alone may skip the attempt row. */
  recordAttempt?: boolean;
};

const DEFAULT_MAX_TOKENS = 700;
const MAX_FALLBACK_REASON_CHARS = 120;

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error && typeof error.name === "string"
    ? error.name
    : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/** Postgres/Neon errors carry a 5-char SQLSTATE — those abort the transaction and need a rollback. */
function isSqlError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return true;
  return /current transaction is aborted/i.test(errorMessage(error));
}

/** Map any failure on the model path to the fallback taxonomy. Exported for tests. */
export function classifyRenderFailure(error: unknown): string {
  const name = errorName(error);
  const message = errorMessage(error);
  if (error instanceof ChatProviderResolutionError || name === "ChatProviderResolutionError") {
    return "no_provider";
  }
  if (name === "ApprovalRequiredError") return "approval_required";
  if (name === "AiPolicyDeniedError") return "policy_denied";
  if (name === "BillingDisabledError") return "cap_hit:kill_switch";
  const classified = classifyMeteredAiError(error);
  if (classified) {
    if (classified.reason === "approval_required") return "approval_required";
    if (classified.reason === "policy_denied") return "policy_denied";
    return `cap_hit:${classified.reason}`.slice(0, MAX_FALLBACK_REASON_CHARS);
  }
  if (/Billing account is not configured|must configure a BYO AI key/i.test(message)) {
    return "billing_not_configured";
  }
  if (
    name === "ChatUpstreamTimeoutError" ||
    (name === "SubscriptionBridgeError" &&
      (error as { degraded?: string }).degraded === "bridge-timeout") ||
    /timed out|timeout|did not answer in time/i.test(message)
  ) {
    return "timeout";
  }
  return "provider_error";
}

async function savepoint(client: PoolClient, name: string): Promise<boolean> {
  try {
    await client.query(`SAVEPOINT ${name}`);
    return true;
  } catch {
    return false;
  }
}

async function recordRenderAttempt(
  client: PoolClient,
  row: {
    orgId: string;
    userId: string;
    feature: string;
    mode: RenderMode;
    modelId: string | null;
    provider: string | null;
    fallbackReason: string | null;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  },
): Promise<void> {
  // Own savepoint: a database that has not run 0498 yet must not lose the feature output.
  const held = await savepoint(client, "ai_render_attempt");
  try {
    await client.query(
      `INSERT INTO ai_render_attempts
         (org_id, feature, mode, model_id, provider, fallback_reason,
          prompt_tokens, completion_tokens, cost_usd, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)`,
      [
        row.orgId,
        row.feature.slice(0, 80),
        row.mode,
        row.modelId,
        row.provider,
        row.fallbackReason ? row.fallbackReason.slice(0, MAX_FALLBACK_REASON_CHARS) : null,
        Math.max(0, Math.round(row.promptTokens)),
        Math.max(0, Math.round(row.completionTokens)),
        Math.max(0, row.costUsd),
        row.userId,
      ],
    );
    if (held) await client.query("RELEASE SAVEPOINT ai_render_attempt");
  } catch {
    if (held) await client.query("ROLLBACK TO SAVEPOINT ai_render_attempt").catch(() => undefined);
  }
}

type ModelReceipt = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export async function renderWithModel(input: RenderWithModelInput): Promise<RenderWithModelResult> {
  const requestId = input.requestId ?? `${input.feature}-render-${randomUUID()}`;
  const record = input.recordAttempt ?? true;

  const fallback = async (
    reason: string,
    resolved?: ResolvedOrgChatAdapter | null,
  ): Promise<RenderWithModelResult> => {
    const text = input.template();
    if (record) {
      await recordRenderAttempt(input.client, {
        orgId: input.orgId,
        userId: input.userId,
        feature: input.feature,
        mode: "template",
        modelId: resolved?.provenance.modelId ?? null,
        provider: resolved?.provenance.provider ?? null,
        fallbackReason: reason,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
      });
    }
    return {
      text,
      mode: "template",
      feature: input.feature,
      fallbackReason: reason,
      requestId,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      ...(resolved ? { modelId: resolved.provenance.modelId, provider: resolved.provenance.provider } : {}),
    };
  };

  let resolved: ResolvedOrgChatAdapter;
  try {
    const resolve = input.resolveAdapter ?? resolveOrgChatAdapterWithProvenance;
    resolved = await resolve(input.client, {
      orgId: input.orgId,
      userId: input.userId,
      promptCachingEnabled: input.promptCachingEnabled ?? true,
      feature: input.feature,
      bridgeTransport: input.bridgeTransport,
    });
  } catch (error) {
    const reason = classifyRenderFailure(error);
    return fallback(reason === "provider_error" ? "resolve_error" : reason, null);
  }

  const adapter: ChatAdapter = resolved.adapter;
  const context: ContextItem[] = [
    ...(input.system?.trim()
      ? [{ type: "module_fact" as const, id: "render-instructions", content: input.system.trim(), importance: 1000 }]
      : []),
    ...(input.context ?? []),
  ];
  const promptTokens =
    Math.ceil(input.prompt.length / 4) +
    context.reduce((sum, item) => sum + Math.ceil(item.content.length / 4), 0);
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const estimatedCostUsd = estimateCostUsd({
    provider: adapter.provider,
    model: adapter.model,
    promptTokens,
    maxTokens,
    prices: adapter.prices ?? null,
  });

  const metered = input.metered ?? meteredAI;
  const held = await savepoint(input.client, "ai_render_model");
  let receipt: ModelReceipt;
  try {
    receipt = await metered<ModelReceipt>({
      client: input.client,
      orgId: input.orgId,
      userId: input.userId,
      feature: input.feature,
      requestId,
      estimatedCostUsd,
      estimatedPromptTokens: promptTokens,
      estimatedCompletionTokens: maxTokens,
      provider: adapter.provider,
      model: adapter.model,
      metadata: {
        ...(input.metadata ?? {}),
        renderPath: "model",
        modelSource: resolved.provenance.source,
        promptCachingEnabled: input.promptCachingEnabled ?? true,
      },
      invoke: async () => {
        const result = await adapter.complete({
          message: input.prompt,
          context,
          promptCachingEnabled: input.promptCachingEnabled,
        });
        return {
          value: {
            text: result.text,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            costUsd: result.costUsd,
          },
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          costUsd: result.costUsd,
          model: adapter.model,
          provider: adapter.provider,
          cacheReadInputTokens: result.cacheReadInputTokens,
          cacheWriteInputTokens: result.cacheWriteInputTokens,
          uncachedInputTokens: result.uncachedInputTokens,
        };
      },
    });
    if (held) await input.client.query("RELEASE SAVEPOINT ai_render_model");
  } catch (error) {
    if (held) {
      // Billing cutoffs and governance holds wrote rows on purpose (denials, approvals):
      // keep them. Only a SQL failure has aborted the transaction and needs the rollback.
      if (isSqlError(error)) {
        await input.client.query("ROLLBACK TO SAVEPOINT ai_render_model").catch(() => undefined);
      } else {
        await input.client.query("RELEASE SAVEPOINT ai_render_model").catch(() => undefined);
      }
    }
    return fallback(classifyRenderFailure(error), resolved);
  }

  const text = (receipt.text ?? "").trim();
  const modelId = adapter.model || resolved.provenance.modelId;
  const provider = adapter.provider || resolved.provenance.provider;
  if (!text || text === "No response.") {
    return fallback("empty_output", resolved);
  }
  if (input.accept && !input.accept(text)) {
    return fallback("rejected_output", resolved);
  }

  if (record) {
    await recordRenderAttempt(input.client, {
      orgId: input.orgId,
      userId: input.userId,
      feature: input.feature,
      mode: "model",
      modelId,
      provider,
      fallbackReason: null,
      promptTokens: receipt.promptTokens,
      completionTokens: receipt.completionTokens,
      costUsd: receipt.costUsd,
    });
  }
  return {
    text,
    mode: "model",
    feature: input.feature,
    modelId,
    provider,
    requestId,
    promptTokens: receipt.promptTokens,
    completionTokens: receipt.completionTokens,
    costUsd: receipt.costUsd,
  };
}

// ---------------------------------------------------------------------------
// Structured rendering: same-shape JSON with only named prose fields rewritten
// ---------------------------------------------------------------------------

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Strip fences / prose around a JSON payload and parse it; null when it is not JSON. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const starts = [candidate.indexOf("{"), candidate.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

const MAX_EDITED_STRING_GROWTH = 6;
const MAX_EDITED_STRING_FLOOR = 4000;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isAcceptableRewrite(original: string, edited: unknown): edited is string {
  if (typeof edited !== "string" || !edited.trim()) return false;
  const cap = Math.max(MAX_EDITED_STRING_FLOOR, original.length * MAX_EDITED_STRING_GROWTH);
  return edited.length <= cap;
}

/**
 * True when `candidate` has exactly the template's structure: same arrays lengths, same
 * object keys, every non-editable leaf strictly equal, every editable string leaf a
 * non-empty string of sane length. Editable keys apply at any depth.
 */
export function structureMatches(template: unknown, candidate: unknown, editableKeys: readonly string[]): boolean {
  if (Array.isArray(template)) {
    if (!Array.isArray(candidate) || candidate.length !== template.length) return false;
    return template.every((item, index) => structureMatches(item, candidate[index], editableKeys));
  }
  if (template && typeof template === "object") {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const templateRecord = template as Record<string, unknown>;
    const candidateRecord = candidate as Record<string, unknown>;
    const templateKeys = Object.keys(templateRecord).sort();
    const candidateKeys = Object.keys(candidateRecord).sort();
    if (templateKeys.length !== candidateKeys.length) return false;
    if (templateKeys.some((key, index) => key !== candidateKeys[index])) return false;
    return templateKeys.every((key) => {
      const original = templateRecord[key];
      const edited = candidateRecord[key];
      if (editableKeys.includes(key) && typeof original === "string") {
        return isAcceptableRewrite(original, edited);
      }
      if (editableKeys.includes(key) && isStringArray(original)) {
        // e.g. rationale: string[] — same number of lines, each rewritten, none empty.
        return (
          Array.isArray(edited) &&
          edited.length === original.length &&
          original.every((line, index) => isAcceptableRewrite(line, edited[index]))
        );
      }
      return structureMatches(original, edited, editableKeys);
    });
  }
  return Object.is(template, candidate) || (typeof template === "number" && template === candidate);
}

/** Copy only the editable string leaves from `edited` onto a clone of `template`. */
export function applyEditableFields<T>(template: T, edited: unknown, editableKeys: readonly string[]): T {
  if (Array.isArray(template)) {
    const editedArray = Array.isArray(edited) ? edited : [];
    return template.map((item, index) => applyEditableFields(item, editedArray[index], editableKeys)) as T;
  }
  if (template && typeof template === "object") {
    const editedRecord = edited && typeof edited === "object" ? (edited as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      if (editableKeys.includes(key) && typeof value === "string") {
        const candidate = editedRecord[key];
        out[key] = typeof candidate === "string" && candidate.trim() ? candidate.trim() : value;
      } else if (editableKeys.includes(key) && isStringArray(value)) {
        const candidate = editedRecord[key];
        out[key] =
          Array.isArray(candidate) && candidate.length === value.length
            ? value.map((line, index) => {
                const edited = candidate[index];
                return typeof edited === "string" && edited.trim() ? edited.trim() : line;
              })
            : value;
      } else {
        out[key] = applyEditableFields(value, editedRecord[key], editableKeys);
      }
    }
    return out as T;
  }
  return template;
}

export type RenderStructuredInput<T> = Omit<RenderWithModelInput, "prompt" | "template" | "accept"> & {
  /** The deterministic value (numbers, enums, ids stay exactly as computed). */
  value: T;
  /** Names of string fields — at any depth — the model may rewrite. */
  editableKeys: readonly string[];
  /** What the document is and how to write the prose (audience, tone, what not to invent). */
  instructions: string;
  /** Optional compact facts the prose may draw on beyond the value itself. */
  facts?: string;
};

export function buildStructuredPrompt(input: {
  instructions: string;
  editableKeys: readonly string[];
  value: unknown;
  facts?: string;
}): string {
  return [
    input.instructions.trim(),
    "",
    input.facts?.trim() ? `Facts (the only source of truth):\n${input.facts.trim()}\n` : "",
    `Below is a JSON document. Rewrite ONLY the string fields named ${input.editableKeys
      .map((key) => `"${key}"`)
      .join(", ")} as clear prose for this team. Keep every other field, every id, number, enum, array length and key exactly as given — do not add, remove or reorder anything, and do not invent facts, numbers, names or events that are not in the document.`,
    "Return ONLY the JSON document, no markdown fences and no commentary.",
    "",
    JSON.stringify(input.value),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Structured variant: the model receives the template value as JSON and may rewrite only
 * the named prose fields; anything else that differs is rejected and the template stands.
 */
export async function renderStructuredWithModel<T>(
  input: RenderStructuredInput<T>,
): Promise<{ value: T; render: RenderOutcome }> {
  const { value, editableKeys, instructions, facts, ...rest } = input;
  const rendered = await renderWithModel({
    ...rest,
    prompt: buildStructuredPrompt({ instructions, editableKeys, value, facts }),
    template: () => JSON.stringify(value),
    accept: (text) => structureMatches(value, parseJsonLoose(text), editableKeys),
    metadata: { ...(rest.metadata ?? {}), editableKeys: [...editableKeys] },
  });
  const outcome: RenderOutcome = {
    mode: rendered.mode,
    feature: rendered.feature ?? rest.feature,
    requestId: rendered.requestId,
    ...(rendered.modelId ? { modelId: rendered.modelId } : {}),
    ...(rendered.provider ? { provider: rendered.provider } : {}),
    ...(rendered.fallbackReason ? { fallbackReason: rendered.fallbackReason } : {}),
  };
  if (rendered.mode !== "model") return { value, render: outcome };
  const parsed = parseJsonLoose(rendered.text);
  return { value: applyEditableFields(value, parsed, editableKeys), render: outcome };
}

/**
 * For features whose output is purely numeric/enumerated (nothing a model could write
 * without inventing): records an honest template-only attempt so governance counts it,
 * and returns the outcome without ever calling a model.
 */
export async function recordTemplateOnlyRender(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  feature: string;
  reason?: string;
}): Promise<RenderOutcome> {
  const requestId = `${input.feature}-render-${randomUUID()}`;
  const reason = input.reason ?? "deterministic_only";
  await recordRenderAttempt(input.client, {
    orgId: input.orgId,
    userId: input.userId,
    feature: input.feature,
    mode: "template",
    modelId: null,
    provider: null,
    fallbackReason: reason,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
  });
  return { mode: "template", feature: input.feature, fallbackReason: reason, requestId };
}

/** Narrow a RenderWithModelResult to the outcome the API/UI needs. */
export function renderOutcomeOf(result: RenderOutcome): RenderOutcome {
  return {
    mode: result.mode,
    ...(result.feature ? { feature: result.feature } : {}),
    requestId: result.requestId,
    ...(result.modelId ? { modelId: result.modelId } : {}),
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
  };
}

/** Honest attribution kind for a render outcome — the UI never shows "AI" for a template. */
export function renderAttributionKind(mode: RenderMode | null | undefined): "ai" | "template" {
  return mode === "model" ? "ai" : "template";
}
