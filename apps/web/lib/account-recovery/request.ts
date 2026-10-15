/**
 * An account recovery request: someone locked out of their account asks a person on the
 * Vantage team to check who they are. Nothing is reset or unlocked automatically; the request
 * is emailed to the Vantage inboxes and answered by hand.
 */

export type RecoveryRequest = {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  lastPassword: string;
  recoveryEmail: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Today in YYYY-MM-DD (UTC), for the date-of-birth upper bound. */
function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The request as typed, or the first thing to fix, in words. */
export function parseRecoveryRequest(
  body: Record<string, unknown>,
  now: Date = new Date(),
): { ok: true; request: RecoveryRequest } | { ok: false; field: keyof RecoveryRequest; error: string } {
  const request: RecoveryRequest = {
    firstName: text(body.firstName, 80),
    lastName: text(body.lastName, 80),
    email: text(body.email, 254).toLowerCase(),
    dateOfBirth: text(body.dateOfBirth, 10),
    // Kept exactly as typed (no trimming inside): it is compared by a person, never stored.
    lastPassword: typeof body.lastPassword === "string" ? body.lastPassword.slice(0, 200) : "",
    recoveryEmail: text(body.recoveryEmail, 254).toLowerCase(),
  };
  if (!request.firstName) return { ok: false, field: "firstName", error: "Enter your first name." };
  if (!request.lastName) return { ok: false, field: "lastName", error: "Enter your last name." };
  if (!EMAIL.test(request.email)) return { ok: false, field: "email", error: "Enter the email address of the account you can't get into." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.dateOfBirth) || request.dateOfBirth > today(now) || request.dateOfBirth < "1900-01-01") {
    return { ok: false, field: "dateOfBirth", error: "Enter your date of birth." };
  }
  if (request.recoveryEmail && !EMAIL.test(request.recoveryEmail)) {
    return { ok: false, field: "recoveryEmail", error: "Check the recovery email, or leave it blank." };
  }
  return { ok: true, request };
}

/** The email the Vantage team reviews. Plain text, one fact per line. */
export function recoveryMail(request: RecoveryRequest, context: { ip: string | null; at: Date }): { subject: string; lines: string[] } {
  return {
    subject: `[Vantage account recovery] ${request.firstName} ${request.lastName} <${request.email}>`,
    lines: [
      "Someone asked for help getting back into their Vantage account. Check who they are before",
      "doing anything; nothing has been reset or unlocked.",
      "",
      `Name: ${request.firstName} ${request.lastName}`,
      `Account email: ${request.email}`,
      `Date of birth: ${request.dateOfBirth}`,
      `Recovery email: ${request.recoveryEmail || "(none given)"}`,
      `Last remembered password: ${request.lastPassword ? request.lastPassword : "(none given)"}`,
      "",
      `Sent ${context.at.toISOString()}${context.ip ? ` from network ${context.ip}` : ""}.`,
      "Reply to the account email (or the recovery email) once you have checked. Delete this email when done: it may hold an old password.",
    ],
  };
}
