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
  /** Extra powers (manage_members, …) — only meaningful for students and guests. */
  capabilities?: string[];
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

export type InviteNotice = {
  tone: "ok" | "warn" | "error";
  message: string;
  /** The link to copy, shown inside the message so the next step sits beside it. */
  link?: { id: string; url: string } | null;
  /** Put back what was just undone (a revoked invite comes back with the same role). */
  undo?: { label: string; run: () => void } | null;
};

/** Last IndexedDB copy of Team admin membership — never invented counts. */
export type TeamAdminSnapshot = {
  invites: Invite[];
  members: Member[];
  adminTenure: AdminTenure | null;
  accessRequests: AccessRequest[];
  providers: CustomProvider[];
  deliveryMode: InviteDeliveryMode | null;
  /** Per-member hub allowlists (no rows = every section). Optional for older cached copies. */
  hubAccessByUser?: Record<string, Array<{ hubId: string; allowedTabIds: string[] }>>;
};

export type { InviteDeliveryMode };
