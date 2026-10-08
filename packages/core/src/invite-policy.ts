/** New and reissued invitations expire after one day; existing links retain their recorded expiry. */
export const ORGANIZATION_INVITE_HOURS = 24;

export function organizationInviteExpiresAt(hours = ORGANIZATION_INVITE_HOURS, now = Date.now()): Date {
  const duration = Number.isFinite(hours) ? Math.min(Math.max(hours, 1), ORGANIZATION_INVITE_HOURS) : ORGANIZATION_INVITE_HOURS;
  return new Date(now + duration * 3_600_000);
}
