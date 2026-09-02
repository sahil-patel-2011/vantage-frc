/**
 * `npm run free-relay:serve` — the process that listens on the Pi.
 *
 * Bound to loopback. Requires FREE_RELAY_API_KEY. Forwards /v1/* to the
 * FreeBuff-shaped proxy on the same box. Requests are concurrent — chat,
 * CAD assistant, and agent loops share the box without a global queue.
 * Streaming is passed through as-is so a chat token can reach Vantage
 * the moment the upstream emits it.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  attachWorkspaceToChatBody,
  authorizePiLayer,
  catalogFallback,
  clampChatCompletionBody,
  healthPayload,
  joinUpstream,
  piLayerErrorBody,
  readPiLayerConfig,
  redactSecrets,
  routePiLayer,
  type PiLayerConfig,
} from "./pi-layer";
import {
  estimateTokensFromText,
  PiDeviceTelemetry,
  readUsageFromCompletionBody,
  readUsageFromSse,
  sanitizeFeatureLabel,
} from "./device-telemetry";
import { ensureOrgWorkspace } from "./org-workspace-fs";
import { PLATFORM_FREEBUFF_RELAY_NAME } from "./org-workspace";
import {
  admitOfficialFreebuffSession,
  officialFreebuffChat,
  readOfficialFreebuffCredentials,
} from "./official-freebuff-session";

const config = readPiLayerConfig();
const telemetry = new PiDeviceTelemetry(config.maxConcurrent);

if (!config.apiKey) {
  console.error("FREE_RELAY_API_KEY is required. The layer will not start without one.");
  process.exitCode = 1;
} else {
  const server = createServer((req, res) => {
    void handle(req, res, config);
  });
  server.listen(config.port, config.bindHost, () => {
    console.log(
      `[pi-layer] ${PLATFORM_FREEBUFF_RELAY_NAME} listening on ${config.bindHost}:${config.port} → ${config.upstreamBaseUrl} (${config.providerLabel}/${config.model}, max ${config.maxConcurrent} concurrent)`,
    );
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, cfg: PiLayerConfig): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${cfg.bindHost}`);
  const route = routePiLayer(req.method ?? "GET", url.pathname);

  if (route === "unknown") {
    json(res, 404, piLayerErrorBody(404, `No route for ${req.method} ${url.pathname}`));
    return;
  }

  if (route === "health") {
    const upstreamOk = await probeUpstream(cfg);
    const snap = telemetry.snapshot();
    json(res, 200, healthPayload(cfg, upstreamOk, { activeRequests: snap.activeRequests, maxConcurrent: snap.maxConcurrent }));
    return;
  }

  if (!authorizePiLayer(header(req, "authorization"), cfg.apiKey)) {
    json(res, 401, piLayerErrorBody(401, "Relay key required."));
    return;
  }

  if (route === "stats") {
    const upstreamOk = await probeUpstream(cfg);
    const snap = telemetry.snapshot();
    json(res, 200, {
      ok: true,
      bind: `${cfg.bindHost}:${cfg.port}`,
      provider: cfg.providerLabel,
      model: cfg.model,
      upstream: cfg.upstreamBaseUrl,
      upstreamOk,
      isolation:
        "per-org coding folders + request-scoped context — this box does not store another team's memory",
      device: PLATFORM_FREEBUFF_RELAY_NAME,
      concurrency: {
        active: snap.activeRequests,
        max: snap.maxConcurrent,
        available: snap.available,
        byFeature: snap.byFeature,
      },
      tokens: {
        day: snap.day,
        in: snap.tokensIn,
        out: snap.tokensOut,
        outPerSec: snap.tokensOutPerSec,
      },
    });
    return;
  }

  const feature = sanitizeFeatureLabel(header(req, "x-vantage-feature"));
  if (route === "chat" && !telemetry.tryBegin(feature)) {
    json(
      res,
      429,
      piLayerErrorBody(429, `Relay is at ${cfg.maxConcurrent} concurrent requests. Chat, CAD, and agents share this box.`),
    );
    return;
  }

  try {
    await forward(req, res, cfg, url.pathname, route, feature);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[pi-layer]", redactSecrets(message));
    if (!res.headersSent) {
      json(res, 503, piLayerErrorBody(503, "Upstream FreeBuff proxy is unreachable."));
    } else {
      res.end();
    }
  } finally {
    if (route === "chat") telemetry.end(feature);
  }
}

async function forward(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: PiLayerConfig,
  pathname: string,
  route: ReturnType<typeof routePiLayer>,
  feature: string,
): Promise<void> {
  const rawBody = req.method === "POST" ? await readBody(req) : undefined;
  const orgId = header(req, "x-vantage-org-id");
  const workspace = route === "chat" ? await ensureOrgWorkspace(orgId).catch((error) => {
    console.error("[pi-layer] org workspace", redactSecrets(error instanceof Error ? error.message : String(error)));
    return null;
  }) : null;
  const body =
    route === "chat" && rawBody != null
      ? attachWorkspaceToChatBody(clampChatCompletionBody(rawBody, cfg.model), workspace)
      : rawBody;
  const target = joinUpstream(cfg.upstreamBaseUrl, pathname);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: {
        accept: header(req, "accept") || "application/json",
        "content-type": header(req, "content-type") || "application/json",
        authorization: header(req, "authorization") || `Bearer ${cfg.apiKey}`,
        "x-vantage-feature": feature,
        ...(orgId ? { "x-vantage-org-id": orgId } : {}),
      },
      body,
    });
  } catch (error) {
    if (route === "models") {
      json(res, 200, catalogFallback(cfg));
      return;
    }
    if (route === "chat" && body) {
      const official = await chatViaOfficialLogin(cfg, body);
      if (official) {
        res.statusCode = official.status;
        res.setHeader("content-type", official.contentType);
        res.setHeader("cache-control", "no-store");
        tallyChat(body, official.text, official.contentType);
        res.end(official.text);
        return;
      }
    }
    throw error;
  }

  if (route === "models" && !upstream.ok) {
    json(res, 200, catalogFallback(cfg));
    return;
  }

  if (route === "chat" && !upstream.ok && body) {
    const official = await chatViaOfficialLogin(cfg, body);
    if (official) {
      res.statusCode = official.status;
      res.setHeader("content-type", official.contentType);
      res.setHeader("cache-control", "no-store");
      tallyChat(body, official.text, official.contentType);
      res.end(official.text);
      return;
    }
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  res.statusCode = upstream.status;
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");

  if (!upstream.body) {
    const text = await upstream.text();
    if (route === "chat") tallyChat(body ?? "", text, contentType);
    res.end(text);
    return;
  }

  const reader = upstream.body.getReader();
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(Buffer.from(value));
        res.write(value);
      }
    }
  } finally {
    res.end();
    if (route === "chat") tallyChat(body ?? "", Buffer.concat(chunks).toString("utf8"), contentType);
  }
}

function tallyChat(requestBody: string, responseBody: string, contentType: string): void {
  const usage =
    readUsageFromCompletionBody(responseBody) ??
    (contentType.includes("text/event-stream") ? readUsageFromSse(responseBody) : null);
  if (usage) {
    telemetry.record(usage.prompt, usage.completion);
    return;
  }
  telemetry.record(estimateTokensFromText(requestBody), estimateTokensFromText(responseBody));
}

async function probeUpstream(cfg: PiLayerConfig): Promise<boolean> {
  try {
    const response = await fetch(joinUpstream(cfg.upstreamBaseUrl, "/v1/models"), {
      method: "GET",
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(4_000),
    });
    if (response.ok) return true;
  } catch {
    // Coder UI /v1 is optional when official `freebuff login` is on this box.
  }
  const home = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || "";
  return Boolean(home && (await readOfficialFreebuffCredentials(home)));
}

async function chatViaOfficialLogin(
  cfg: PiLayerConfig,
  body: string,
): Promise<{ status: number; contentType: string; text: string } | null> {
  const home = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || "";
  const creds = home ? await readOfficialFreebuffCredentials(home) : null;
  if (!creds) return null;
  const session = await admitOfficialFreebuffSession({ token: creds.authToken, model: cfg.model });
  if (!session.ok && session.status !== "model_locked") {
    return {
      status: 503,
      contentType: "application/json",
      text: JSON.stringify(piLayerErrorBody(503, session.detail ?? "Official Freebuff session was refused.")),
    };
  }
  const result = await officialFreebuffChat({
    token: creds.authToken,
    model: session.model ?? cfg.model,
    body,
    instanceId: session.instanceId,
    userId: creds.id,
    clientId: creds.fingerprintId ?? creds.id,
  });
  return { status: result.status, contentType: result.contentType, text: result.text };
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
