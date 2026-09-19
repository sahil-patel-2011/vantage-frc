/**
 * When, and whether, anyone can sign themselves up.
 *
 * Vantage has been invite-only since it existed: a platform admin provisions a
 * team and its owner, owners invite exact addresses, and everyone else lands on
 * the waitlist. That is not an incidental default — it is the reason a team can
 * put student names into this product at all, and `waitlistOnly: true` was a
 * literal type so nothing could flip it by accident.
 *
 * Opening it is a real decision with a date attached, so this makes it a real
 * switch with a date attached, and requires **two independent things** to be
 * true before the doors open:
 *
 *   1. The planned date has passed.
 *   2. Somebody set `VANTAGE_PUBLIC_SIGNUP=open` on the deployment.
 *
 * Either alone does nothing. A stray environment variable cannot open sign-up
 * early, and the date arriving cannot open it without a human deciding to.
 * Both are deliberately boring to satisfy, and both are easy to reverse: unset
 * the variable and it is closed again on the next boot.
 *
 * Until then every caller sees exactly what it saw before.
 */

/**
 * The earliest date public sign-up may open, as a plain `YYYY-MM-DD`.
 *
 * Set a month out from the decision to open it (2026-09-19), which leaves time
 * to finish the things open sign-up implies and nobody has done yet: abuse
 * rate-limiting on account creation, a verified-email gate before a workspace
 * can be claimed, and a story for what a brand-new account with no team is
 * allowed to see. Moving this date earlier is a decision, not a tidy-up.
 */
export const PUBLIC_SIGNUP_EARLIEST = "2026-10-19";

/** The value `VANTAGE_PUBLIC_SIGNUP` must hold. Anything else stays closed. */
export const PUBLIC_SIGNUP_ENV_VALUE = "open";

function earliestAsDate(): Date {
  // Midnight UTC on the planned day.
  return new Date(`${PUBLIC_SIGNUP_EARLIEST}T00:00:00Z`);
}

/**
 * Has the planned date arrived? Separate from the switch so a status screen can
 * say "scheduled, not yet" and "scheduled, waiting on the operator" as the
 * different things they are.
 */
export function publicSignupDateReached(now: Date = new Date()): boolean {
  const earliest = earliestAsDate();
  if (Number.isNaN(earliest.getTime()) || Number.isNaN(now.getTime())) return false;
  return now.getTime() >= earliest.getTime();
}

export function publicSignupEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.VANTAGE_PUBLIC_SIGNUP ?? "").trim().toLowerCase() === PUBLIC_SIGNUP_ENV_VALUE;
}

/** Both conditions, or closed. */
export function isPublicSignupOpen(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return publicSignupEnvEnabled(env) && publicSignupDateReached(now);
}

export type PublicSignupStatus = {
  open: boolean;
  /** `YYYY-MM-DD` the switch becomes available. */
  earliest: string;
  dateReached: boolean;
  envEnabled: boolean;
  /** One line for an operator, naming what is still holding it closed. */
  reason: string;
};

export function publicSignupStatus(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): PublicSignupStatus {
  const dateReached = publicSignupDateReached(now);
  const envEnabled = publicSignupEnvEnabled(env);
  const open = envEnabled && dateReached;
  const reason = open
    ? "Public sign-up is open."
    : !dateReached && !envEnabled
      ? `Invite-only. Public sign-up is scheduled for ${PUBLIC_SIGNUP_EARLIEST} and still needs VANTAGE_PUBLIC_SIGNUP=open.`
      : !dateReached
        ? `Invite-only until ${PUBLIC_SIGNUP_EARLIEST}. The switch is set; the date has not arrived.`
        : `Invite-only. The date has passed — set VANTAGE_PUBLIC_SIGNUP=open to allow sign-up.`;
  return { open, earliest: PUBLIC_SIGNUP_EARLIEST, dateReached, envEnabled, reason };
}
