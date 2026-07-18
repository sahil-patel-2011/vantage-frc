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
  /** Who holds the role; null/empty means unfilled. */
  holderName: string | null;
  isLead: boolean;
  responsibilities: string | null;
  notes: string | null;
  seasonYear: number;
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
