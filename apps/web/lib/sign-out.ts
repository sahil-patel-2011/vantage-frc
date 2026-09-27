import { safeAppPath } from "./security/safe-navigation";
import { clearFeatureSnapshotsOnSignOut } from "./offline/feature-cache";

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
  try {
    await clearFeatureSnapshotsOnSignOut();
  } catch {
    window.alert("You are signed out, but downloaded views could not be cleared. Clear this site's browser storage before sharing this device.");
  }
  window.location.assign(safeAppPath(redirectTo, "/"));
  return true;
}
