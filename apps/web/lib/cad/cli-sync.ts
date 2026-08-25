/**
 * Validation for the vantage-cad terminal sync payload (POST /api/cad/sync).
 * The CLI is authenticated by its paired device token; this module only shapes
 * and bounds the untrusted JSON body — org/user scoping happens inside the
 * record_cad_cli_session SECURITY DEFINER function (migration 0451).
 */

export type CadCliSyncEvent = {
  tool: string;
  params: Record<string, string | number | boolean>;
  at: string;
  ok: boolean;
  error?: string;
};

export type CadCliSyncPayload = {
  sessionId: string;
  platform: "onshape" | "fusion360" | null;
  documentRef: Record<string, string> | null;
  event: CadCliSyncEvent | null;
  status: "running" | "completed" | "failed";
};

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const TOOL_NAME = /^[a-z0-9_]{1,64}$/;
const DOC_REF_KEYS = ["documentId", "workspaceId", "elementId", "documentName", "url"] as const;
const MAX_EVENT_PARAMS = 12;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Keep only primitive params, clipped — never nested objects, never secrets-sized blobs. */
export function summarizeCadToolParams(raw: unknown): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_EVENT_PARAMS) break;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue;
    if (/key|secret|token|password|credential|authorization/i.test(key)) continue;
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string") out[key] = clip(value, 80);
  }
  return out;
}

export function parseCadCliSyncPayload(body: unknown): CadCliSyncPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Sync payload must be a JSON object");
  }
  const raw = body as Record<string, unknown>;

  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  if (!SESSION_ID.test(sessionId)) throw new Error("sessionId must be 8-64 URL-safe characters");

  const status = raw.status;
  if (status !== "running" && status !== "completed" && status !== "failed") {
    throw new Error("status must be running, completed, or failed");
  }

  const platform =
    raw.platform === "onshape" || raw.platform === "fusion360" ? raw.platform : null;

  let documentRef: Record<string, string> | null = null;
  if (raw.documentRef && typeof raw.documentRef === "object" && !Array.isArray(raw.documentRef)) {
    const picked: Record<string, string> = {};
    for (const key of DOC_REF_KEYS) {
      const value = (raw.documentRef as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) picked[key] = clip(value.trim(), 200);
    }
    if (Object.keys(picked).length) documentRef = picked;
  }

  let event: CadCliSyncEvent | null = null;
  if (raw.event && typeof raw.event === "object" && !Array.isArray(raw.event)) {
    const candidate = raw.event as Record<string, unknown>;
    const tool = typeof candidate.tool === "string" ? candidate.tool.trim() : "";
    if (!TOOL_NAME.test(tool)) throw new Error("event.tool must be a lowercase tool name");
    const at =
      typeof candidate.at === "string" && Number.isFinite(Date.parse(candidate.at))
        ? new Date(candidate.at).toISOString()
        : new Date().toISOString();
    event = {
      tool,
      params: summarizeCadToolParams(candidate.params),
      at,
      ok: candidate.ok !== false,
      ...(typeof candidate.error === "string" && candidate.error.trim()
        ? { error: clip(candidate.error.trim(), 300) }
        : {}),
    };
  }

  return { sessionId, platform, documentRef, event, status };
}
