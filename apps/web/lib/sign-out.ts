import { clearServiceWorkerCachesOnSignOut } from "./scout-media/client";
import { safeAppPath } from "./security/safe-navigation";

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
  // Shared pit tablet: the next scout must not inherit this team's cached
  // shell pages or pit photos from the service worker.
  await clearServiceWorkerCachesOnSignOut().catch(() => undefined);
  window.location.assign(safeAppPath(redirectTo, "/"));
}
