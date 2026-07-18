// Collaborative pick-list domain types. Pure data shapes — no I/O, no framework imports.

export type PicklistCollabTier = "first_pick" | "second_pick" | "avoid" | "unranked";

export type PicklistCollabListStatus = "open" | "locked" | "archived";

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
