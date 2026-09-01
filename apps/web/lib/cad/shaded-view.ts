/**
 * Normalize Onshape GET …/shadedviews output into a PNG data URL.
 *
 * Onshape returns JSON `{ images: [base64Png] }` (sometimes a string, sometimes
 * a nested object). Callers may also hand in raw PNG bytes. Missing bodies,
 * 401/403, and anything that is not a real PNG become `{ status: "empty", message }`
 * — never a DEMO cube or invented geometry.
 */

import { isoShadedViewPath, type OnshapeHttp } from "@vantage/cad";

export type ShadedViewReady = {
  status: "ready";
  pngBase64: string;
  dataUrl: string;
};

export type ShadedViewEmpty = {
  status: "empty";
  message: string;
  pngBase64: null;
  dataUrl: null;
};

export type ShadedViewResult = ShadedViewReady | ShadedViewEmpty;

export type ShadedViewInput = {
  /** HTTP status from Onshape. Defaults to 200 when omitted. */
  status?: number;
  /** Parsed JSON body (`{ images: […] }`) or a base64 / data-URL string. */
  body?: unknown;
  /** Raw PNG bytes, or UTF-8 bytes of the JSON body. */
  bytes?: Uint8Array | ArrayBuffer | Buffer | string | null;
};

export const SHADED_VIEW_UNAUTHORIZED =
  "Onshape did not authorize this shaded view. Connect Onshape and try again.";

export const SHADED_VIEW_MISSING =
  "No Onshape shaded-view PNG is available. The viewport stays empty until a real render arrives.";

export const SHADED_VIEW_NOT_PNG =
  "Onshape returned bytes that are not a PNG shaded view. The viewport stays empty.";

export const SHADED_VIEW_UNBOUND =
  "Bind a Part Studio before a shaded view can load.";

export const SHADED_VIEW_FAILED =
  "Could not load a shaded view from Onshape. The viewport stays empty.";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const DATA_URL_PREFIX = "data:image/png;base64,";

function empty(message: string): ShadedViewEmpty {
  return { status: "empty", message, pngBase64: null, dataUrl: null };
}

function ready(pngBase64: string): ShadedViewReady {
  return { status: "ready", pngBase64, dataUrl: `${DATA_URL_PREFIX}${pngBase64}` };
}

function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

function asUint8Array(value: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value);
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function stripDataUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith(DATA_URL_PREFIX)) {
    return trimmed.slice(DATA_URL_PREFIX.length).replace(/\s+/g, "");
  }
  return trimmed.replace(/\s+/g, "");
}

/** Accept only a base64 payload that decodes to a real PNG. */
function decodePngBase64(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const base64 = stripDataUrl(value);
  if (base64.length < 32 || /[^A-Za-z0-9+/=]/.test(base64)) return null;
  try {
    const bytes = Buffer.from(base64, "base64");
    if (!isPngBytes(bytes)) return null;
    return bytes.toString("base64");
  } catch {
    return null;
  }
}

function extractFromBody(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === "string") {
    const parsed = tryParseJson(body);
    if (parsed !== undefined) return extractFromBody(parsed);
    return decodePngBase64(body);
  }
  if (typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const images = record.images;
  if (typeof images === "string") return decodePngBase64(images);
  if (Array.isArray(images)) {
    const first = images[0];
    if (typeof first === "string") return decodePngBase64(first);
    if (first && typeof first === "object") {
      for (const value of Object.values(first as Record<string, unknown>)) {
        const decoded = decodePngBase64(value);
        if (decoded) return decoded;
      }
    }
  }
  for (const key of ["image", "png", "data"] as const) {
    const decoded = decodePngBase64(record[key]);
    if (decoded) return decoded;
  }
  return null;
}

function fromBytes(bytes: Uint8Array | ArrayBuffer | Buffer | string): ShadedViewResult | null {
  if (typeof bytes === "string") {
    const extracted = extractFromBody(bytes);
    if (extracted) return ready(extracted);
    const raw = Buffer.from(stripDataUrl(bytes), "base64");
    if (isPngBytes(raw)) return ready(raw.toString("base64"));
    return null;
  }
  const raw = asUint8Array(bytes);
  if (isPngBytes(raw)) return ready(Buffer.from(raw).toString("base64"));
  const extracted = extractFromBody(new TextDecoder().decode(raw));
  return extracted ? ready(extracted) : null;
}

function emptyForStatus(status: number): ShadedViewEmpty | null {
  if (status === 401 || status === 403) return empty(SHADED_VIEW_UNAUTHORIZED);
  if (status === 404) {
    return empty("No shaded view is available for this Part Studio yet.");
  }
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    return empty("Onshape did not return a shaded view. Open the Part Studio in Onshape to inspect it.");
  }
  return null;
}

/**
 * Turn mock or live shadedviews output into a PNG data URL, or an honest empty.
 * Never invents geometry (no DEMO cube).
 */
export function shadedViewFromOnshape(input: ShadedViewInput): ShadedViewResult {
  const status = input.status ?? (input.body != null || input.bytes != null ? 200 : 0);
  const byStatus = emptyForStatus(status);
  if (byStatus) return byStatus;

  if (input.bytes != null) {
    return fromBytes(input.bytes) ?? empty(SHADED_VIEW_NOT_PNG);
  }
  const extracted = extractFromBody(input.body);
  if (extracted) return ready(extracted);
  return empty(SHADED_VIEW_MISSING);
}

export type ShadedViewDocument = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

/**
 * One GET …/shadedviews call. Failures (including 401) stay empty — the
 * caller never substitutes a placeholder render.
 */
export async function loadShadedView(
  http: OnshapeHttp,
  document: ShadedViewDocument,
): Promise<ShadedViewResult> {
  const documentId = String(document.documentId ?? "").trim();
  const workspaceId = String(document.workspaceId ?? "").trim();
  const elementId = String(document.elementId ?? "").trim();
  if (!documentId || !workspaceId || !elementId) return empty(SHADED_VIEW_UNBOUND);

  try {
    const path = isoShadedViewPath({ documentId, workspaceId, elementId });
    const response = await http(path);
    const contentType = response.headers.get("content-type") ?? "";
    if (/image\/png|octet-stream/i.test(contentType)) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return shadedViewFromOnshape({ status: response.status, bytes });
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return shadedViewFromOnshape({ status: response.status, body });
  } catch {
    return empty(SHADED_VIEW_FAILED);
  }
}
