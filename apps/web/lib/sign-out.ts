import { safeAppPath } from "./security/safe-navigation";
import { forgetOfflineIdentity } from "./offline/identity";
import { clearFeatureSnapshotsOnSignOut } from "./offline/feature-cache";
import { PENDING_INVITE_STORAGE_KEY } from "./invite/invite-flow";
import { ONBOARDING_ANSWERS_PREFIX } from "./onboarding/entry-journey";
import { clearPendingCode, tabStorage } from "./sign-in/pending-code";
import { browserStorage, clearRememberedAccount } from "./sign-in/remembered-account";
import { forgetAccountMemory } from "./nav/shell-memory";

/**
 * What the way in left on this device about the person: the address sign-in remembered, a code
 * step kept for a reload, and onboarding answers not yet saved. Teams share shop laptops and
 * school Chromebooks; the next person signing in saw the last one's full school address
 * prefilled, often with their name in it (QA A1-09).
 */
export function forgetEntryTraces(): void {
  clearRememberedAccount(browserStorage());
  clearPendingCode(tabStorage());
  // The avatar letter and team role the shell showed while loading.
  forgetAccountMemory(browserStorage() as Pick<Storage, "removeItem"> | null);
  for (const store of [browserStorage(), tabStorage()]) {
    try {
      if (!store || !("length" in store)) continue;
      const storage = store as Storage;
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(ONBOARDING_ANSWERS_PREFIX)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    } catch {
      // Storage blocked: nothing was kept there either.
    }
  }
}

/** Better Auth client sign-out — clears session cookies then hard-navigates away. */
export async function signOutAndRedirect(redirectTo = "/") {
  try {
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Sign-out failed");
  } catch {
    window.alert("Could not sign out. Check your connection and try again.");
    return false;
  }
  forgetOfflineIdentity();
  try { window.sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY); } catch { /* URL invitation handoffs remain intact. */ }
  forgetEntryTraces();
  const [snapshots] = await Promise.allSettled([
    clearFeatureSnapshotsOnSignOut(),
    typeof caches === "undefined" ? Promise.resolve() : caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith("vantage-shell-")).map(key => caches.delete(key)))),
  ]);
  if (snapshots.status === "rejected") {
    window.alert("You are signed out, but downloaded views could not be cleared. Clear this site's browser storage before sharing this device.");
  }
  window.location.assign(safeAppPath(redirectTo, "/"));
  return true;
}
