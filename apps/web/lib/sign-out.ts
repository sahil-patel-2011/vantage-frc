import { safeAppPath } from "./security/safe-navigation";
import { forgetOfflineIdentity } from "./offline/identity";
import { clearFeatureSnapshotsOnSignOut } from "./offline/feature-cache";
import { PENDING_INVITE_STORAGE_KEY } from "./invite/invite-flow";

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
