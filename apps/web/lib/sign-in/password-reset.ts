/** Provider acknowledgement is required before showing the reset-code step. */
export async function requestPasswordResetCode(email: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/auth/email-otp/request-password-reset", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(response.status === 429
    ? "Too many password reset requests. Wait a few minutes before trying again."
    : "A reset code could not be requested. Try again shortly, or use a sign-in code.");
}
