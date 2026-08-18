// Collaborative pick-list domain types. Pure data shapes — no I/O, no framework imports.

export type PicklistCollabTier = "first_pick" | "second_pick" | "avoid" | "unranked";

export type PicklistCollabListStatus = "open" | "locked" | "archived";

/** FAST-style EPA role from auto/teleop share vs the event field. */
export type EpaRoleId =
  | "elite_auto"
  | "elite_all_around"
  | "auto_specialist"
  | "primary_scorer"
  | "high_value_hybrid"
  | "teleop_reliable"
  | "auto_contributor";

export type PicklistCollabVote = {
  id: string;
  voterId: string;
  weight: number;
  rankSuggestion: number | null;
  comment: string | null;
  updatedAt: string;
};

export type PicklistCollabEntry = {
  id: string;
  teamNumber: number;
  teamName: string | null;
  tier: PicklistCollabTier;
  position: number;
  note: string | null;
  addedBy: string;
  votes: PicklistCollabVote[];
  /** Sum of vote weight, this entry's consensus signal. */
  weightedScore: number;
  /** Weight-averaged rank suggestion across voters who gave one (null if none did). */
  averageRankSuggestion: number | null;
  epaTotal?: number | null;
  epaAuto?: number | null;
  epaTeleop?: number | null;
  /** FAST-style role from cached Statbotics EPA shares — null when the cache has no row. */
  epaRole?: EpaRoleId | null;
};

export type PicklistCollabList = {
  id: string;
  eventKey: string;
  name: string;
  seasonYear: number;
  status: PicklistCollabListStatus;
  createdBy: string;
  updatedAt: string;
};

export type PicklistCollabSummary = {
  totalEntries: number;
  totalVotes: number;
  totalVoters: number;
  byTier: Array<{ tier: PicklistCollabTier; count: number }>;
};
