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
  window.location.assign(safeAppPath(redirectTo, "/"));
}
