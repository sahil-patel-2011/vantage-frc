/**
 * The Blue Alliance webhook (Firehose) request authentication.
 *
 * TBA POSTs `{ message_type, message_data }` and sends `X-TBA-HMAC`: the
 * HMAC-SHA256 of the RAW request body, keyed with the secret configured on the
 * TBA account's webhook, hex-encoded. The HMAC is over the exact bytes TBA sent —
 * so the handler must read `request.text()` and verify BEFORE `JSON.parse`;
 * re-serializing the parsed object changes key order and whitespace and the
 * signature stops matching.
 *
 * Without `TBA_WEBHOOK_SECRET` we refuse every delivery rather than accepting
 * unauthenticated pushes that would fan out notifications to real teams.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type TbaWebhookVerification =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: string };

export function tbaWebhookSecret(): string | null {
  const secret = (process.env.TBA_WEBHOOK_SECRET ?? "").trim();
  return secret ? secret : null;
}

/** Hex digest TBA should have sent for this body. Exported for the docs' curl example and tests. */
export function computeTbaHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(Buffer.from(rawBody, "utf8")).digest("hex");
}

/** Tolerate `sha256=` prefixes and casing; reject anything that is not a hex digest. */
function normalizeHeader(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim().replace(/^sha256=/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify one delivery. `secret` is injected so tests never depend on env, and so
 * a future per-account secret rotation can pass both values in turn.
 */
export function verifyTbaWebhook(input: {
  rawBody: string;
  header: string | null;
  secret: string | null;
}): TbaWebhookVerification {
  if (!input.secret) {
    return {
      ok: false,
      status: 503,
      reason:
        "TBA_WEBHOOK_SECRET is not configured. Set it and register the webhook in your TBA account before enabling deliveries.",
    };
  }
  const provided = normalizeHeader(input.header);
  if (!provided) {
    return { ok: false, status: 401, reason: "Missing or malformed X-TBA-HMAC header." };
  }
  const expected = computeTbaHmac(input.rawBody, input.secret);
  if (!constantTimeEquals(provided, expected)) {
    return { ok: false, status: 401, reason: "X-TBA-HMAC does not match the request body." };
  }
  return { ok: true };
}
