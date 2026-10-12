/**
 * How long an email invite link works. Pool-free, so Team admin's form imports the choices
 * (`@vantage/core/invite-policy`).
 *
 * Every link used to die after 24 hours with no choice: a parent invited on Friday evening
 * found a dead link on Saturday night, and each resend killed the link already sent. The owner
 * or admin now picks how long the link works, from a day (the default, the safest) up to a
 * week. Existing links keep the expiry they were sent with; a resend keeps the lifetime the
 * invite was created with.
 */
export const ORGANIZATION_INVITE_HOURS = 24;
export const ORGANIZATION_INVITE_MAX_HOURS = 168;

/** The lifetimes Team admin offers, shortest first. The first is the default. */
export const INVITE_LIFETIME_CHOICES: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

export function clampInviteHours(hours: number | null | undefined): number {
  if (typeof hours !== "number" || !Number.isFinite(hours)) return ORGANIZATION_INVITE_HOURS;
  return Math.min(Math.max(Math.round(hours), 1), ORGANIZATION_INVITE_MAX_HOURS);
}

export function organizationInviteExpiresAt(hours: number = ORGANIZATION_INVITE_HOURS, now = Date.now()): Date {
  return new Date(now + clampInviteHours(hours) * 3_600_000);
}

/**
 * "24 hours", "3 days", "7 days": how long a link works, for the invite email and Team admin.
 * Whole days from 48 hours up, hours below that.
 */
export function inviteLifetimeWords(hours: number): string {
  const value = clampInviteHours(hours);
  if (value >= 48 && value % 24 === 0) return `${value / 24} days`;
  return value === 1 ? "1 hour" : `${value} hours`;
}
