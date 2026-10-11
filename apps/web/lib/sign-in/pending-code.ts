/**
 * The code step, kept for this tab while its code is still good.
 *
 * Phones often reload the tab on the way back from the mail app, and a refresh or Back then
 * Forward did the same: the person landed on the email step with a valid code in their inbox and
 * only "Email me a sign-in code" to press (QA A1-15). Session storage is per tab and gone when
 * the tab closes; only the address and the two clocks are kept, never the code.
 */

import { DEFAULT_CODE_TTL_SECONDS, isLikelyEmail, normalizeSignInEmail } from "./otp-code";
import type { StorageLike } from "./remembered-account";

export const PENDING_CODE_STORAGE_KEY = "vantage.signin.pendingCode";

export type PendingCode = { email: string; codeExpiresAt: number; resendAvailableAt: number | null };

export function writePendingCode(store: StorageLike | null | undefined, value: PendingCode): void {
  if (!store) return;
  try {
    store.setItem(PENDING_CODE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode: a reload starts at the email step, as before.
  }
}

export function clearPendingCode(store: StorageLike | null | undefined): void {
  try {
    store?.removeItem(PENDING_CODE_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The kept step, or null when there is none, it expired, or it does not look like ours. */
export function readPendingCode(store: StorageLike | null | undefined, now: number): PendingCode | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PENDING_CODE_STORAGE_KEY);
    if (!raw || raw.length > 1_000) return null;
    const value = JSON.parse(raw) as Partial<PendingCode> | null;
    const email = normalizeSignInEmail(typeof value?.email === "string" ? value.email : "");
    const expiresAt = Number(value?.codeExpiresAt);
    const resendAt = value?.resendAvailableAt == null ? null : Number(value.resendAvailableAt);
    const fresh =
      isLikelyEmail(email) &&
      Number.isFinite(expiresAt) &&
      expiresAt > now &&
      // A clock from the future (a bad value, a changed system clock) is not trusted.
      expiresAt <= now + DEFAULT_CODE_TTL_SECONDS * 1_000 + 5_000 &&
      (resendAt === null || Number.isFinite(resendAt));
    if (!fresh) {
      store.removeItem(PENDING_CODE_STORAGE_KEY);
      return null;
    }
    return { email, codeExpiresAt: expiresAt, resendAvailableAt: resendAt };
  } catch {
    return null;
  }
}

/** Per-tab storage, or null on the server and in private modes that block it. */
export function tabStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}
