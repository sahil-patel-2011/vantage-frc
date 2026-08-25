import { verifierMatchesChallenge } from "./codes";

/**
 * Pure decision logic for the desktop-link poll and exchange routes, kept out of
 * the route handlers so single-use and expiry semantics are unit-testable
 * without a database. The routes hold a FOR UPDATE row lock while consulting
 * these, which is what makes the single-use decisions race-free.
 */

export type DesktopLinkRow = {
  approved_user_id: string | null;
  code_challenge: string;
  auth_code_hash: string | null;
  auth_code_expires_at: Date | null;
  consumed_at: Date | null;
  expires_at: Date;
};

export type PollDecision =
  /** Request TTL elapsed before approval (or before the code was picked up). */
  | { status: "expired" }
  /** The one-time authorization code was already released or spent. */
  | { status: "consumed" }
  /** No approval yet — keep polling. */
  | { status: "pending" }
  /** Approved and never released: mint the authorization code NOW, exactly once. */
  | { status: "release"; userId: string };

export function decidePoll(row: DesktopLinkRow | undefined, now: Date): PollDecision {
  if (!row) return { status: "expired" };
  if (row.consumed_at) return { status: "consumed" };
  // Once released, the plaintext is gone forever — a second poll can never
  // re-issue it, even inside the TTL window.
  if (row.auth_code_hash) return { status: "consumed" };
  if (row.expires_at.getTime() <= now.getTime()) return { status: "expired" };
  if (!row.approved_user_id) return { status: "pending" };
  return { status: "release", userId: row.approved_user_id };
}

export type ExchangeDecision =
  | { ok: true; userId: string }
  /** Unknown code, unapproved request, already consumed, or verifier mismatch. */
  | { ok: false; reason: "invalid" | "verifier_mismatch" }
  | { ok: false; reason: "expired" };

/**
 * The row is looked up by sha256(authCode), so reaching here at all proves the
 * caller holds a released code; possession of the ORIGINAL verifier is what
 * proves the caller is the desktop that started the flow.
 */
export function decideExchange(
  row: DesktopLinkRow | undefined,
  verifier: unknown,
  now: Date,
): ExchangeDecision {
  if (!row) return { ok: false, reason: "invalid" };
  if (row.consumed_at) return { ok: false, reason: "invalid" };
  if (!row.approved_user_id || !row.auth_code_hash) return { ok: false, reason: "invalid" };
  if (!row.auth_code_expires_at || row.auth_code_expires_at.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (!verifierMatchesChallenge(verifier, row.code_challenge)) {
    return { ok: false, reason: "verifier_mismatch" };
  }
  return { ok: true, userId: row.approved_user_id };
}
