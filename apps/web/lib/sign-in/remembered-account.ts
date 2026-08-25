/**
 * Return-visit memory for `/signin`.
 *
 * Only the address the person typed and which button they used last — never a
 * code, a token, or anything that could stand in for a session. Both values are
 * clearable from the sign-in card itself.
 */

import { isLikelyEmail, normalizeSignInEmail } from "./otp-code";

export const LAST_EMAIL_STORAGE_KEY = "vantage.signin.lastEmail";
export const LAST_METHOD_STORAGE_KEY = "vantage.signin.lastMethod";

export type SignInMethod = "google" | "email";

export type RememberedAccount = {
  email: string | null;
  method: SignInMethod | null;
};

/** The slice of `localStorage` we use — injectable so this stays testable. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const EMPTY_REMEMBERED_ACCOUNT: RememberedAccount = { email: null, method: null };

function isMethod(value: string | null): value is SignInMethod {
  return value === "google" || value === "email";
}

export function readRememberedAccount(store: StorageLike | null | undefined): RememberedAccount {
  if (!store) return EMPTY_REMEMBERED_ACCOUNT;
  try {
    const rawEmail = normalizeSignInEmail(store.getItem(LAST_EMAIL_STORAGE_KEY));
    const rawMethod = store.getItem(LAST_METHOD_STORAGE_KEY);
    return {
      // Junk in storage is treated as nothing rather than prefilled blindly.
      email: isLikelyEmail(rawEmail) ? rawEmail : null,
      method: isMethod(rawMethod) ? rawMethod : null,
    };
  } catch {
    return EMPTY_REMEMBERED_ACCOUNT;
  }
}

export function writeRememberedAccount(
  store: StorageLike | null | undefined,
  value: { email?: string | null; method?: SignInMethod | null },
): void {
  if (!store) return;
  try {
    if (value.email !== undefined) {
      const email = normalizeSignInEmail(value.email);
      if (isLikelyEmail(email)) store.setItem(LAST_EMAIL_STORAGE_KEY, email);
      else store.removeItem(LAST_EMAIL_STORAGE_KEY);
    }
    if (value.method !== undefined) {
      if (isMethod(value.method ?? null)) store.setItem(LAST_METHOD_STORAGE_KEY, value.method as string);
      else store.removeItem(LAST_METHOD_STORAGE_KEY);
    }
  } catch {
    /* private mode / storage disabled — remembering is a convenience, not a requirement */
  }
}

export function clearRememberedAccount(store: StorageLike | null | undefined): void {
  if (!store) return;
  try {
    store.removeItem(LAST_EMAIL_STORAGE_KEY);
    store.removeItem(LAST_METHOD_STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Which method to lead with. A remembered choice wins only while it is still
 * configured — Google that has since lost its credentials must not be
 * preselected into a dead end.
 */
export function preferredSignInMethod(
  remembered: RememberedAccount,
  available: { google: boolean; email: boolean },
): SignInMethod {
  if (remembered.method === "google" && available.google) return "google";
  if (remembered.method === "email" && available.email) return "email";
  return available.email ? "email" : available.google ? "google" : "email";
}

/** Browser-only accessor; server renders and private mode both yield null. */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
