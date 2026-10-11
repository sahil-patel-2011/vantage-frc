import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * GitHub signs each webhook delivery with HMAC-SHA256 of the raw body under the secret given
 * when the hook was created, in `X-Hub-Signature-256: sha256=<hex>`. Compare in constant time;
 * a missing or malformed header is simply not valid.
 */
export function verifyGitHubSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const given = Buffer.from(header, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** The opaque token in a team's webhook URL: 32 random bytes, base64url (43 characters). */
export function newWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The HMAC secret GitHub signs deliveries with. Stored encrypted, never shown again. */
export function newWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export function isWebhookToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
