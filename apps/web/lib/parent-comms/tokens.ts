import { randomBytes } from "node:crypto";

/**
 * Opaque capability tokens for parent contacts (view link + unsubscribe link).
 * Matches the calendar_feed_tokens charset from migration 0144 —
 * [A-Za-z0-9_-]{16,100} — which is also what proxy.ts allow-lists and the
 * parent_contacts CHECK constraints enforce.
 */
export const PARENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

/** 32 base64url chars (~192 bits) — comfortably inside the 16..100 window. */
export function newParentToken(): string {
  return randomBytes(24).toString("base64url");
}

export function isParentToken(value: unknown): value is string {
  return typeof value === "string" && PARENT_TOKEN_PATTERN.test(value);
}

/** Guard for route params — throws instead of ever querying with a bad token. */
export function assertToken(value: unknown): string {
  if (!isParentToken(value)) throw new Error("invalid_token");
  return value;
}
