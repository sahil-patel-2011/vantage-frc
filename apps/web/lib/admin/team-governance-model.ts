/**
 * Shapes and words for team requests and bans, safe to import in the browser. The database work
 * is in team-governance.ts (server only).
 */

export type TeamRequestStatus = "pending" | "approved" | "declined" | "withdrawn" | "forwarded";

export type TeamRequest = {
  id: string;
  teamNumber: number;
  teamName: string | null;
  status: TeamRequestStatus;
  orgId: string | null;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  requestedTeamRole: string | null;
  crewRole: string | null;
  roleDescription: string | null;
  declineReason: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
};

export const BAN_REASONS = ["terms", "privacy", "terms_and_privacy", "other"] as const;
export type BanReason = (typeof BAN_REASONS)[number];

export const BAN_REASON_LABELS: Record<BanReason, string> = {
  terms: "Broke the Terms of Service",
  privacy: "Broke the Privacy Policy",
  terms_and_privacy: "Broke the Terms and the Privacy Policy",
  other: "Other",
};

export type TeamBan = {
  teamNumber: number;
  reason: BanReason;
  note: string | null;
  bannedAt: string;
  bannedByEmail: string | null;
  orgName: string | null;
  memberCount: number;
};
