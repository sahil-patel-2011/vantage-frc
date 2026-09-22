/**
 * Pure moderation vocabulary and wording — safe to import from client components
 * (lib/messages/moderation.ts holds the database side).
 */

export const REPORT_REASONS = [
  { id: "harassment", label: "Harassment or bullying" },
  { id: "inappropriate", label: "Not OK for a youth team" },
  { id: "safety", label: "Someone may be unsafe" },
  { id: "spam", label: "Spam" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export const REMOVED_BY_ADMIN_TEXT = "Removed by a team admin";

export function isReportReason(value: unknown): value is ReportReason {
  return REPORT_REASONS.some((reason) => reason.id === value);
}

export function canModerate(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export type MessageRemoval = {
  removedAt: string;
  /** Only for the author; null for everyone else. */
  reason: string | null;
  /** What to render in place of the message. */
  notice: string;
};

/** The text shown where a removed message was. The author learns it was theirs; nobody else learns more than that an admin removed it. */
export function removalNotice(input: { mine: boolean; reason: string | null }): string {
  if (!input.mine) return REMOVED_BY_ADMIN_TEXT;
  return input.reason
    ? `A team admin removed your message. Reason: ${input.reason}`
    : "A team admin removed your message.";
}

/**
 * What the reporter is told after reporting. When the only person who could review it is the
 * author themself, the reporter is told that honestly and pointed at a trusted adult.
 */
export function reportReceipt(input: { authorIsModerator: boolean; otherModerators: number }): string {
  if (input.otherModerators === 0) {
    return input.authorIsModerator
      ? "Reported. The person who wrote this is the only owner or admin on this team, so nobody else here can review it — please tell a mentor, parent, or coach you trust, or contact FIRST Youth Protection."
      : "Reported. This team has no owner or admin to review it yet — please tell a mentor, parent, or coach you trust.";
  }
  return "Reported. Your team's owners and admins can see this report; the person who wrote the message cannot.";
}
