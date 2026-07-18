// Cross-team scrim domain types. Pure data shapes — no I/O, no framework imports.
// Tracks scrimmage scheduling with nearby teams and the accompanying shared-data agreement
// (whether match/scouting data collected during the scrim will be exchanged, and on what terms).

export type ScrimStatus = "proposed" | "accepted" | "declined" | "scheduled" | "completed" | "cancelled";

export type ScrimDataShareScope = "none" | "match_results" | "full_scouting" | "video_only";

export type ScrimInvite = {
  id: string;
  partnerTeamNumber: number;
  partnerTeamName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  proposedDate: string | null;
  location: string | null;
  status: ScrimStatus;
  dataShareScope: ScrimDataShareScope;
  dataShareAgreed: boolean;
  notes: string | null;
  seasonYear: number;
};

export type ScrimSummary = {
  total: number;
  byStatus: Array<{ status: ScrimStatus; count: number }>;
  agreedDataShareCount: number;
  upcomingCount: number;
};
