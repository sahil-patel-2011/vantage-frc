/** Public waitlist copy. Safe for the client bundle — no database imports. */
import { PUBLIC_SIGNUP_DATE_LABEL } from "@vantage/core/public-signup";

export function waitlistUnavailableCopy(): { title: string; body: string } {
  return {
    title: "Waitlist isn't taking names right now.",
    body: "Email vantagefrc@gmail.com and we'll add you when it's ready. Joining the waitlist does not create an account.",
  };
}

export function waitlistUnavailableMessage(): string {
  return waitlistUnavailableCopy().body;
}

/**
 * When teams get set up, said the same way on Home, sign-in and the waitlist. The waitlist used to
 * promise "usually within a few days" beside a sign-in page that said December 1 (QA A1-05).
 */
export const LAUNCH_TIMELINE = `Public team registration is planned from ${PUBLIC_SIGNUP_DATE_LABEL}. Existing early-access teams can sign in now.`;

export function waitlistJoinedCopy(recorded: { email: string; team: string } | null): { body: string; kept: string } {
  const who = recorded?.email ? recorded.email : "you";
  const team = recorded?.team ? `team ${recorded.team}` : "your team";
  return {
    body: `We'll email ${who} when ${team} can be set up. ${LAUNCH_TIMELINE} Then you sign in and invite your students and mentors.`,
    // Said to everyone, so it never reveals whether the address was already on the list. A later
    // submission does not change the first one (lib/marketing/waitlist.ts upsert).
    kept: "Already on the list? We kept the details from the first time. To change them, email vantagefrc@gmail.com.",
  };
}

/** Thrown by the form for the server's own sentence, so it can be shown as it is. */
export class WaitlistServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaitlistServerError";
  }
}

/**
 * What to say when sending failed. A dropped connection is a TypeError ("Failed to fetch"), which
 * is an Error too, so it used to be shown word for word (QA A1-06).
 */
export function waitlistSubmitErrorMessage(error: unknown): string {
  if (error instanceof WaitlistServerError && error.message) return error.message;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "We couldn't confirm your request in time. Your details are still here. Try again; the same email will not create a duplicate request.";
  }
  return "We couldn't reach Vantage. Your details are still here. Check your connection and try again.";
}

/** The email field's message, or null. Each mistake gets its own sentence (QA A1-24). */
export function waitlistEmailProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter the email you want us to write to.";
  if (/\s/.test(value)) return "Email addresses can't have spaces in them.";
  const at = value.split("@");
  if (at.length === 1) return "That email is missing the @ and the part after it.";
  if (at.length > 2) return "An email address has only one @.";
  const [local, domain] = at as [string, string];
  if (!local) return "That email is missing the part before the @.";
  if (!domain) return "That email is missing the part after the @, like school.org.";
  if (!/\.[^.]+$/.test(domain) || domain.startsWith(".")) {
    return "That email is missing the part after the dot, like .com or .org.";
  }
  return null;
}

export const WAITLIST_SMS_CONSENT_ERROR = "Tick this box to get launch texts, or clear the phone number.";
