export function inviteAcceptanceFailure(status: number, payload: { code?: string; error?: string }) {
  if (status === 401) return { kind: "auth_required" as const, message: payload.error ?? "Sign in with the invited email to accept." };
  if (status === 403 && payload.code === "AGE_ELIGIBILITY_REQUIRED") {
    return { kind: "profile_required" as const, message: payload.error ?? "Finish your profile to confirm that you are age 13 or older." };
  }
  if (status === 403 && payload.code === "INVITE_EMAIL_MISMATCH") {
    return { kind: "email_mismatch" as const, message: payload.error ?? "This invite was sent to a different email address." };
  }
  return { kind: "error" as const, message: payload.error ?? "Could not accept invitation." };
}
