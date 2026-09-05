import { readFile } from "node:fs/promises";
import { resolveSelectableFreebuffModel } from "@vantage/agent";

/**
 * Official Freebuff CLI login — not a third-party proxy.
 *
 * After `freebuff login`, credentials land in ~/.config/manicode/credentials.json.
 * This module is the same HTTP the official CLI uses: admit a session, then
 * POST /api/v1/chat/completions with that session. Files for a team stay in
 * FREEBUFF_WORKSPACE_ROOT/org-<uuid>/.
 */

/** Official CLI login talks to the Codebuff app host (Freebuff is the free mode). */
export const OFFICIAL_FREEBUFF_ORIGIN = "https://www.codebuff.com";
export const FREEBUFF_INSTANCE_HEADER = "x-freebuff-instance-id";
export const FREEBUFF_MODEL_HEADER = "x-freebuff-model";
export const FREEBUFF_ACTING_USER_HEADER = "x-freebuff-acting-user-id";
export const OFFICIAL_FREEBUFF_AGENT_ID = "base3-free-glm-5-3-flash";

/**
 * Official base3 roots open with this sentence. The free-mode gate is a
 * byte-exact prefix on the first system message — anything else is billed.
 */
export const OFFICIAL_FREEBUFF_SYSTEM_OPENING = "You are Buffy, the coding agent behind Codebuff.";

/** Vantage picker slugs → official Freebuff wire ids. */
const OFFICIAL_WIRE_MODEL: Record<string, string> = {
  "glm/glm-5.3-flash": "z-ai/glm-5.3-flash",
  "glm-5.3-flash": "z-ai/glm-5.3-flash",
  "z-ai/glm-5.3-flash": "z-ai/glm-5.3-flash",
  "mimo/mimo-2.5": "mimo/mimo-v2.5",
  "mimo-2.5": "mimo/mimo-v2.5",
  "mimo/mimo-v2.5": "mimo/mimo-v2.5",
  "deepseek/deepseek-v4-flash": "deepseek/deepseek-v4-flash",
  "deepseek-v4-flash": "deepseek/deepseek-v4-flash",
};

const OFFICIAL_AGENT_BY_MODEL: Record<string, string> = {
  "glm/glm-5.3-flash": "base3-free-glm-5-3-flash",
  "z-ai/glm-5.3-flash": "base3-free-glm-5-3-flash",
  "mimo/mimo-2.5": "base3-free-mimo",
  "mimo/mimo-v2.5": "base3-free-mimo",
  "deepseek/deepseek-v4-flash": "base3-free-deepseek-flash",
};

export function toOfficialFreebuffWireModel(model: string): string {
  const key = model.trim().toLowerCase();
  return OFFICIAL_WIRE_MODEL[key] ?? model.trim();
}

export function officialAgentIdForModel(model: string): string {
  const key = toOfficialFreebuffWireModel(model).toLowerCase();
  return OFFICIAL_AGENT_BY_MODEL[key] ?? OFFICIAL_FREEBUFF_AGENT_ID;
}

export function hasOfficialFreebuffSystemOpening(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith(OFFICIAL_FREEBUFF_SYSTEM_OPENING) ||
    trimmed.startsWith("You are Buffy, the strategic coding assistant.")
  );
}

function ensureOfficialFreebuffSystemMessages(
  messages: Array<{ role?: string; content?: unknown }>,
): Array<{ role?: string; content?: unknown }> {
  const firstSystem = messages.findIndex((message) => message?.role === "system");
  if (firstSystem >= 0) {
    const current = messages[firstSystem];
    const content = typeof current?.content === "string" ? current.content : "";
    if (hasOfficialFreebuffSystemOpening(content)) return messages;
    const next = [...messages];
    next[firstSystem] = {
      ...current,
      role: "system",
      content: `${OFFICIAL_FREEBUFF_SYSTEM_OPENING}\n\n${content}`.trim(),
    };
    return next;
  }
  return [{ role: "system", content: OFFICIAL_FREEBUFF_SYSTEM_OPENING }, ...messages];
}

export type OfficialFreebuffCredentials = {
  id?: string;
  name?: string;
  email?: string;
  authToken: string;
  fingerprintId?: string;
};

export function officialCredentialsPath(home: string): string {
  return `${home.replace(/[\\/]+$/, "")}/.config/manicode/credentials.json`;
}

export function officialSessionUrl(origin: string = OFFICIAL_FREEBUFF_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/api/v1/freebuff/session`;
}

export function officialChatUrl(origin: string = OFFICIAL_FREEBUFF_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/api/v1/chat/completions`;
}

export function officialAgentRunsUrl(origin: string = OFFICIAL_FREEBUFF_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/api/v1/agent-runs`;
}

/** Official Freebuff is not an OpenAI tools endpoint — drop function-calling keys. */
export function stripOfficialChatTools(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    delete parsed.tools;
    delete parsed.tool_choice;
    delete parsed.functions;
    delete parsed.function_call;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export function attachOfficialRunToChatBody(
  body: string,
  run: { runId?: string; instanceId?: string; clientId?: string; model?: string },
): string {
  try {
    const parsed = JSON.parse(stripOfficialChatTools(body)) as Record<string, unknown>;
    parsed.costMode = "free";
    if (run.runId) parsed.runId = run.runId;
    if (run.model) parsed.model = run.model;
    const messages = Array.isArray(parsed.messages)
      ? (parsed.messages as Array<{ role?: string; content?: unknown }>)
      : [];
    parsed.messages = ensureOfficialFreebuffSystemMessages(messages);
    const meta =
      parsed.codebuff_metadata && typeof parsed.codebuff_metadata === "object"
        ? { ...(parsed.codebuff_metadata as Record<string, unknown>) }
        : {};
    meta.cost_mode = "free";
    if (run.runId) meta.run_id = run.runId;
    if (run.instanceId) meta.freebuff_instance_id = run.instanceId;
    if (run.clientId) meta.client_id = run.clientId;
    parsed.codebuff_metadata = meta;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export function parseOfficialCredentials(raw: string): OfficialFreebuffCredentials | null {
  try {
    const parsed = JSON.parse(raw) as { default?: { authToken?: unknown } };
    const token = parsed?.default && typeof parsed.default.authToken === "string" ? parsed.default.authToken.trim() : "";
    if (!token) return null;
    const row = parsed.default as OfficialFreebuffCredentials;
    return { ...row, authToken: token };
  } catch {
    return null;
  }
}

export async function readOfficialFreebuffCredentials(
  home: string,
): Promise<OfficialFreebuffCredentials | null> {
  try {
    return parseOfficialCredentials(await readFile(officialCredentialsPath(home), "utf8"));
  } catch {
    return null;
  }
}

export function lastUserPrompt(body: string): string {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: unknown }> };
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role !== "user") continue;
      if (typeof message.content === "string") return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
          .join("\n")
          .trim();
      }
    }
  } catch {
    // fall through
  }
  return "";
}

export function openaiCompletionFromText(model: string, text: string): string {
  return JSON.stringify({
    id: `chatcmpl-vantage-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

export async function readOfficialFreebuffSession(input: {
  token: string;
  origin?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ status: string; instanceId?: string; model?: string }> {
  const origin = input.origin ?? OFFICIAL_FREEBUFF_ORIGIN;
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(officialSessionUrl(origin), {
    method: "GET",
    headers: { authorization: `Bearer ${input.token}` },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return { status: "none" };
  const body = (await response.json().catch(() => null)) as {
    status?: string;
    instanceId?: string;
    model?: string;
    currentModel?: string;
  } | null;
  return {
    status: body?.status ?? `http_${response.status}`,
    instanceId: typeof body?.instanceId === "string" ? body.instanceId : undefined,
    model: body?.model ?? body?.currentModel,
  };
}

function sessionModelOf(body: { model?: string; currentModel?: string } | null, fallback: string): string {
  const raw = body?.model ?? body?.currentModel;
  return typeof raw === "string" && raw.trim() ? toOfficialFreebuffWireModel(raw) : fallback;
}

export async function admitOfficialFreebuffSession(input: {
  token: string;
  model: string;
  origin?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: string; instanceId?: string; model?: string; detail?: string }> {
  const origin = input.origin ?? OFFICIAL_FREEBUFF_ORIGIN;
  const model = toOfficialFreebuffWireModel(resolveSelectableFreebuffModel(input.model));
  const fetchImpl = input.fetchImpl ?? fetch;
  const existing = await readOfficialFreebuffSession({ token: input.token, origin, fetchImpl });
  if (existing.status === "active" && existing.instanceId) {
    return {
      ok: true,
      status: "active",
      instanceId: existing.instanceId,
      model: existing.model ? toOfficialFreebuffWireModel(existing.model) : model,
    };
  }
  const response = await fetchImpl(officialSessionUrl(origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      [FREEBUFF_MODEL_HEADER]: model,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => null)) as {
    status?: string;
    instanceId?: string;
    model?: string;
    currentModel?: string;
    message?: string;
    error?: string;
  } | null;
  if (body?.status === "active" && body.instanceId) {
    return { ok: true, status: "active", instanceId: body.instanceId, model: sessionModelOf(body, model) };
  }
  if (body?.status === "model_locked") {
    const live = await readOfficialFreebuffSession({ token: input.token, origin, fetchImpl });
    return {
      ok: true,
      status: "model_locked",
      instanceId: live.instanceId,
      model: sessionModelOf({ model: live.model, currentModel: body.currentModel }, model),
      detail: "existing session model",
    };
  }
  return {
    ok: false,
    status: body?.status ?? `http_${response.status}`,
    detail: body?.message ?? body?.error ?? `session ${response.status}`,
  };
}

export async function startOfficialAgentRun(input: {
  token: string;
  userId?: string;
  model?: string;
  origin?: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const origin = input.origin ?? OFFICIAL_FREEBUFF_ORIGIN;
  const fetchImpl = input.fetchImpl ?? fetch;
  const agentId = officialAgentIdForModel(input.model ?? "");
  const response = await fetchImpl(officialAgentRunsUrl(origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      ...(input.userId ? { [FREEBUFF_ACTING_USER_HEADER]: input.userId } : {}),
    },
    body: JSON.stringify({ action: "START", agentId, costMode: "free" }),
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const parsed = (await response.json().catch(() => null)) as { runId?: unknown } | null;
  return typeof parsed?.runId === "string" && parsed.runId ? parsed.runId : null;
}

export async function officialFreebuffChat(input: {
  token: string;
  model: string;
  body: string;
  instanceId?: string;
  userId?: string;
  clientId?: string;
  origin?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; contentType: string; text: string }> {
  const origin = input.origin ?? OFFICIAL_FREEBUFF_ORIGIN;
  const model = toOfficialFreebuffWireModel(
    input.model.includes("/") ? input.model : resolveSelectableFreebuffModel(input.model),
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  const runId = await startOfficialAgentRun({
    token: input.token,
    userId: input.userId,
    model,
    origin,
    fetchImpl,
  });
  const body = attachOfficialRunToChatBody(input.body, {
    runId: runId ?? undefined,
    instanceId: input.instanceId,
    clientId: input.clientId,
    model,
  });
  const response = await fetchImpl(officialChatUrl(origin), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
      [FREEBUFF_MODEL_HEADER]: model,
      ...(input.instanceId ? { [FREEBUFF_INSTANCE_HEADER]: input.instanceId } : {}),
      ...(input.userId ? { [FREEBUFF_ACTING_USER_HEADER]: input.userId } : {}),
    },
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "application/json",
    text,
  };
}
