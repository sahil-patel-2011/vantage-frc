import type { InviteDeliveryMode } from "../../lib/team/team-invites";

export type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  lastSentAt: string;
};

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
};

export type AdminTenure = {
  orgCreatedAt: string;
  adminCount: number;
  bootstrapActive: boolean;
  daysRemaining: number | null;
  lastAdminLocked: boolean;
  inviteHint: string | null;
};

export type AccessRequest = {
  id: string;
  userId: string;
  name: string;
  email: string;
  requestedTeamRole: string | null;
  crewRole: string | null;
  roleDescription: string | null;
  primaryFocus: "competition" | "build" | "business" | "leadership";
  status: "pending" | "approved" | "declined" | "withdrawn";
  membershipRole: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type GitHubConnection = {
  id: string;
  authMethod: string;
  label: string;
  status: string;
  githubLogin: string | null;
  defaultRepoFullName: string | null;
  defaultRepoDefaultBranch: string | null;
  scopes: string[];
  lastTestedAt: string | null;
};

export type GitHubRepo = {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
};

export type CustomProvider = {
  id: string;
  label: string;
  kind: string;
  localRelay: boolean;
  enabled: boolean;
  baseUrl?: string | null;
  lastTestedAt?: string | null;
  disabledAt?: string | null;
};

export type InviteNotice = { tone: "ok" | "warn" | "error"; message: string };

export type { InviteDeliveryMode };
