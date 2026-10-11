import { fetchProductSession, invalidateProductSession, productSessionUnreachable } from "../nav/product-session";

const TAB_USER = "vantage-offline-user";
const SHARED_USER = "vantage-session-user";
let signedOut = false;
let listening = false;

/**
 * Sign-in, coming back to the page this tab was on. A sign-out in another tab used to send this
 * one to a bare /signin, so the person lost their place (QA A1-26); /signin checks `next` itself.
 */
export function signInAgainPath(location: { pathname?: string; search?: string } | null | undefined): string {
  const here = `${location?.pathname ?? ""}${location?.search ?? ""}`;
  return here && here !== "/" && !here.startsWith("/signin") ? `/signin?next=${encodeURIComponent(here)}` : "/signin";
}

export function watchSessionBoundary(): void {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  window.addEventListener("storage", event => {
    if (event.key !== SHARED_USER) return;
    const previous = window.sessionStorage.getItem(TAB_USER);
    if (previous && previous !== event.newValue) {
      signedOut = true;
      window.sessionStorage.removeItem(TAB_USER);
      invalidateProductSession();
      window.location.replace(signInAgainPath(window.location));
    }
  });
}

export async function offlineSnapshotUser(orgId: string): Promise<string | null> {
  if (typeof window === "undefined" || signedOut) return null;
  watchSessionBoundary();
  // Personal caches use "_" as a storage key, not as a team identifier.
  const session = await fetchProductSession(orgId.trim() === "_" ? null : orgId);
  if (signedOut) return null;
  if (session?.userId) {
    try {
      window.sessionStorage.setItem(TAB_USER, session.userId);
      if (window.localStorage.getItem(SHARED_USER) !== session.userId) window.localStorage.setItem(SHARED_USER, session.userId);
    } catch { /* Live identity still scopes storage when browser storage is restricted. */ }
    return session.userId;
  }
  // Only an unreachable server permits this tab's previously verified offline identity.
  // A definite authentication/permission rejection cannot reuse it.
  try {
    if (productSessionUnreachable()) {
      const previous = window.sessionStorage.getItem(TAB_USER);
      return previous && window.localStorage.getItem(SHARED_USER) === previous ? previous : null;
    }
    window.sessionStorage.removeItem(TAB_USER);
  } catch { /* No storage means no offline identity. */ }
  return null;
}

export function forgetOfflineIdentity(): void {
  signedOut = true;
  invalidateProductSession();
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TAB_USER);
    window.localStorage.removeItem(SHARED_USER);
  } catch { /* Signed-out reads are blocked even if storage is unavailable. */ }
}
