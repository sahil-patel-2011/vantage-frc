/**
 * Validation for what a browser hands us from `PushSubscription`. Pure so the rules
 * are testable without a session: a malformed row is worse than no row — it would sit
 * in the table failing to encrypt on every single send.
 */
import { isBase64UrlOfLength } from "./encode";

export type ParsedSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  orgId: string | null;
  userAgent: string | null;
};

export type ParseResult =
  | { ok: true; value: ParsedSubscriptionInput }
  | { ok: false; error: string };

/** Push service endpoints are always absolute https URLs. Cap the length the column stores. */
export function isValidPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string") return false;
  const trimmed = endpoint.trim();
  if (!trimmed || trimmed.length > 1000) return false;
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSubscriptionInput(raw: unknown, userAgent?: string | null): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Expected a subscription object." };
  }
  const body = raw as Record<string, unknown>;

  if (!isValidPushEndpoint(body.endpoint)) {
    return { ok: false, error: "endpoint must be an https push service URL." };
  }
  const p256dh = typeof body.p256dh === "string" ? body.p256dh.trim() : "";
  const auth = typeof body.auth === "string" ? body.auth.trim() : "";
  // 65 bytes = uncompressed P-256 point; 16 bytes = the RFC 8291 auth secret.
  if (!isBase64UrlOfLength(p256dh, 65)) {
    return { ok: false, error: "p256dh must be a 65-byte base64url key." };
  }
  if (!isBase64UrlOfLength(auth, 16)) {
    return { ok: false, error: "auth must be a 16-byte base64url secret." };
  }

  const orgIdRaw = body.orgId;
  const orgId = typeof orgIdRaw === "string" && UUID.test(orgIdRaw.trim()) ? orgIdRaw.trim() : null;
  if (orgIdRaw != null && orgIdRaw !== "" && orgId === null) {
    return { ok: false, error: "orgId must be a uuid." };
  }

  return {
    ok: true,
    value: {
      endpoint: (body.endpoint as string).trim(),
      p256dh,
      auth,
      orgId,
      // Only used to label a device in the UI ("Chrome on Windows"); truncated hard.
      userAgent: userAgent ? userAgent.slice(0, 300) : null,
    },
  };
}

/** Short human label for a device row, derived from the stored user agent. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const platform = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "device";
  return `${browser} on ${platform}`;
}
