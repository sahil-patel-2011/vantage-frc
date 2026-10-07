export class PasswordResetRequestError extends Error {}

/** Advance to code entry only after the reset endpoint accepts the request. */
export async function requestPasswordResetCode(email: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/auth/email-otp/request-password-reset", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }), signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return;
  // Keep account existence private; provider errors never mean a code was sent.
  if (response.status === 429) throw new PasswordResetRequestError("Too many reset requests. Wait a little before trying again.");
  throw new PasswordResetRequestError("Could not send a reset code. Try again when the service is available.");
}
