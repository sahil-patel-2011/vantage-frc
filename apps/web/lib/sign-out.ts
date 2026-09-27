import { safeAppPath } from "./security/safe-navigation";
import { forgetOfflineIdentity } from "./offline/identity";
import { clearFeatureSnapshots } from "./offline/feature-cache";
import { PENDING_INVITE_STORAGE_KEY } from "./invite/invite-flow";

/** Better Auth client sign-out — clears session cookies then hard-navigates away. */
export async function signOutAndRedirect(redirectTo = "/") {
  try {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } catch {
    // Still leave the product shell; cookies may already be expired.
  }
  forgetOfflineIdentity();
  try { window.sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY); } catch { /* URL invitation handoffs remain intact. */ }
  await Promise.allSettled([
    clearFeatureSnapshots(),
    typeof caches === "undefined" ? Promise.resolve() : caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith("vantage-shell-")).map(key => caches.delete(key)))),
  ]);
  window.location.assign(safeAppPath(redirectTo, "/"));
}
