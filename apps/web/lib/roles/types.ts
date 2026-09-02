// Roles & Responsibilities domain types. Pure data shapes — no I/O.
// The team's roles (leads and positions) by subteam, who holds each, and what they own.
// The app derives staffing coverage and surfaces unfilled roles.

export type Subteam =
  | "mechanical"
  | "electrical"
  | "programming"
  | "cad"
  | "controls"
  | "business"
  | "drive_team"
  | "scouting"
  | "media"
  | "safety"
  | "other";

export type TeamRole = {
  id: string;
  title: string;
  subteam: Subteam;
  /** Member account holding the role; null when unfilled or held by a non-member. */
  holderUserId: string | null;
  /**
   * Display label for the holder. Resolved from the member's account when
   * holderUserId is set; otherwise the free-text name typed for a non-member.
   * null/empty means unfilled.
   */
  holderName: string | null;
  isLead: boolean;
  responsibilities: string | null;
  notes: string | null;
  seasonYear: number;
};

/** A roster member offered by the holder picker. */
export type RoleMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

/** Resolved holder shape consumed by other features (safety captain, exit interviews). */
export type RoleHolder = {
  roleId: string;
  title: string;
  subteam: Subteam;
  isLead: boolean;
  /** null when the role is held by someone outside the roster (label only). */
  userId: string | null;
  name: string;
};

export type RolesSummary = {
  total: number;
  filled: number;
  unfilled: number;
  /** filled / total (0..1). */
  coverage: number;
  leadsTotal: number;
  leadsFilled: number;
  bySubteam: Array<{ subteam: Subteam; total: number; filled: number }>;
  /** Unfilled roles, leads first. */
  openRoles: TeamRole[];
};
