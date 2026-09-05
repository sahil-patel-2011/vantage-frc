import { FREEBUFF_SELECTABLE_MODELS, resolveSelectableFreebuffModel } from "@vantage/agent";

/**
 * The Pi layer Vantage actually talks to.
 *
 * Vercel never speaks FreeBuff. It speaks OpenAI-compatible HTTP to this process,
 * which is bound to loopback and requires FREE_RELAY_API_KEY. This process then
 * forwards to the signed-in Freebuff Coder UI on the same box. That split is the
 * whole point:
 *
 *   Vantage --tunnel--> this layer (auth, bind, error shape) --loopback--> Freebuff Coder UI /v1
 *
 * Raspberry Pi Connect is how a human reaches the box to operate it. It is not
 * the inbound path for team chat — Connect sessions are interactive and disappear.
 */

export const PI_LAYER_BIND_HOST = "127.0.0.1";
export const PI_LAYER_DEFAULT_PORT = 8080;
/** Freebuff Coder UI local /v1. Override with FREEBUFF_UPSTREAM_URL. */
export const PI_LAYER_DEFAULT_UPSTREAM = "http://127.0.0.1:3457";

export type PiLayerConfig = {
  bindHost: string;
  port: number;
  apiKey: string;
  upstreamBaseUrl: string;
  model: string;
  providerLabel: string;
  maxConcurrent: number;
};

export type PiLayerRoute = "health" | "models" | "chat" | "stats" | "unknown";

export function readPiLayerConfig(env: NodeJS.ProcessEnv = process.env): PiLayerConfig {
  const apiKey = env.FREE_RELAY_API_KEY?.trim() ?? "";
  const port = Number(env.FREE_RELAY_PROXY_PORT ?? env.PI_LAYER_PORT ?? PI_LAYER_DEFAULT_PORT);
  const maxConcurrent = Number(env.FREE_RELAY_MAX_CONCURRENT ?? 16);
  return {
    bindHost: env.PI_LAYER_BIND?.trim() || PI_LAYER_BIND_HOST,
    port: Number.isFinite(port) && port > 0 ? port : PI_LAYER_DEFAULT_PORT,
    apiKey,
    upstreamBaseUrl: (env.FREEBUFF_UPSTREAM_URL ?? env.FREEBUFF_PROXY_URL ?? PI_LAYER_DEFAULT_UPSTREAM)
      .trim()
      .replace(/\/+$/, ""),
    model: resolveSelectableFreebuffModel(env.FREE_RELAY_MODEL),
    providerLabel: env.FREE_RELAY_PROVIDER?.trim() || "freebuff",
    maxConcurrent: Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? Math.min(64, Math.floor(maxConcurrent)) : 16,
  };
}

export function routePiLayer(method: string, pathname: string): PiLayerRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (method === "GET" && (path === "/healthz" || path === "/health")) return "health";
  if (method === "GET" && (path === "/v1/stats" || path === "/stats")) return "stats";
  if (method === "GET" && (path === "/v1/models" || path === "/models")) return "models";
  if (method === "POST" && (path === "/v1/chat/completions" || path === "/chat/completions")) return "chat";
  return "unknown";
}

/**
 * Constant-time-ish compare so a timing oracle on the relay key is not free.
 * Empty expected key is a refuse — an internet-reachable layer without a key
 * is an open pass-through to the FreeBuff account.
 */
export function authorizePiLayer(header: string | undefined, expectedKey: string): boolean {
  const want = expectedKey.trim();
  if (!want) return false;
  const got = bearerToken(header);
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  const len = Math.max(a.length, b.length);
  const left = Buffer.alloc(len);
  const right = Buffer.alloc(len);
  a.copy(left);
  b.copy(right);
  return a.length === b.length && timingSafeEqual(left, right);
}

function bearerToken(header: string | undefined): string {
  const raw = String(header ?? "").trim();
  if (!raw) return "";
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return (match?.[1] ?? raw).trim();
}

function timingSafeEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

export function upstreamPath(pathname: string): string {
  if (pathname.startsWith("/v1/")) return pathname;
  if (pathname === "/models" || pathname === "/models/") return "/v1/models";
  if (pathname === "/chat/completions" || pathname === "/chat/completions/") return "/v1/chat/completions";
  return pathname.startsWith("/") ? `/v1${pathname}` : `/v1/${pathname}`;
}

export function joinUpstream(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${upstreamPath(pathname)}`;
}

/**
 * Statuses RelayFailoverChatAdapter already treats as "try the next pool".
 * Anything else (400, 404) stays as-is so a bad request does not burn backup.
 */
export const PI_LAYER_FAILOVER_STATUSES = new Set([401, 402, 403, 429, 502, 503, 504]);

export function piLayerErrorBody(status: number, message: string): { error: { message: string; type: string; code: string } } {
  const failover = PI_LAYER_FAILOVER_STATUSES.has(status);
  return {
    error: {
      message,
      type: failover ? "upstream_unavailable" : "invalid_request_error",
      code: failover ? "relay_upstream" : "bad_request",
    },
  };
}

export function healthPayload(
  config: PiLayerConfig,
  upstreamOk: boolean | null,
  extras?: { activeRequests?: number; maxConcurrent?: number },
): Record<string, unknown> {
  return {
    ok: true,
    bind: `${config.bindHost}:${config.port}`,
    provider: config.providerLabel,
    model: config.model,
    upstream: config.upstreamBaseUrl,
    upstreamOk,
    activeRequests: extras?.activeRequests ?? 0,
    maxConcurrent: extras?.maxConcurrent ?? config.maxConcurrent,
    note: "Raspberry Pi Connect is for operating this box. Team chat reaches it through the tunnel, not Connect.",
  };
}

export function catalogFallback(config: PiLayerConfig): Record<string, unknown> {
  const slugs = new Set(FREEBUFF_SELECTABLE_MODELS.map((model) => model.slug));
  slugs.add(resolveSelectableFreebuffModel(config.model));
  return {
    object: "list",
    data: [...slugs].map((id) => ({
      id,
      object: "model",
      owned_by: config.providerLabel,
    })),
  };
}

/**
 * Rewrite a chat-completions body to a picker slug. Unknown models become
 * DeepSeek V4 Flash, the free / unlimited / fast default.
 */
export function clampChatCompletionBody(body: string, fallbackModel: string): string {
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    if (!parsed || typeof parsed !== "object") return body;
    parsed.model = resolveSelectableFreebuffModel(
      typeof parsed.model === "string" ? parsed.model : fallbackModel,
    );
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

/**
 * Pin this completion to one team's folder under the shared workspace root.
 * Coder UI still has one session; the path is how files stay per-org.
 */
export function attachWorkspaceToChatBody(
  body: string,
  workspace: { folder: string; note: string } | null,
): string {
  if (!workspace) return body;
  try {
    const parsed = JSON.parse(body) as {
      messages?: Array<{ role?: string; content?: unknown }>;
      workspace?: string;
    };
    if (!parsed || typeof parsed !== "object") return body;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const already = messages.some(
      (message) =>
        message?.role === "system" &&
        typeof message.content === "string" &&
        message.content.includes(workspace.folder),
    );
    parsed.messages = already
      ? messages
      : [{ role: "system", content: workspace.note }, ...messages];
    parsed.workspace = workspace.folder;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

/** Never log the relay key or a FreeBuff token. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted-jwt]");
}
