/** Better Auth client sign-out — clears session cookies then hard-navigates away. */

export async function signOutAndRedirect(redirectTo: "/" | "/signin" = "/") {
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
  window.location.assign(redirectTo);
}
