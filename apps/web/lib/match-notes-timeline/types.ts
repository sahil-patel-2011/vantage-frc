// In-match note timeline domain types. Pure data shapes — no I/O, no framework imports.
// A note is a freeform observation timestamped to the match clock (seconds into auto / teleop /
// endgame) so a team can replay "what happened when" during film review or drive-coach retros.

export type MatchNotePhase = "auto" | "teleop" | "endgame" | "other";

export type MatchNoteCategory = "observation" | "strategy" | "issue" | "highlight" | "other";

export type MatchNoteEntry = {
  id: string;
  matchLabel: string;
  matchKey: string | null;
  teamNumber: number | null;
  seasonYear: number;
  phase: MatchNotePhase;
  category: MatchNoteCategory;
  clockSeconds: number;
  note: string;
  createdAt: string;
};

export type MatchTimeline = {
  matchLabel: string;
  matchKey: string | null;
  teamNumber: number | null;
  entryCount: number;
  lastNoteAt: string | null;
  entries: MatchNoteEntry[];
};

export type MatchNotesTimelineSummary = {
  totalEntries: number;
  totalMatches: number;
  byCategory: Array<{ category: MatchNoteCategory; count: number }>;
  byPhase: Array<{ phase: MatchNotePhase; count: number }>;
};
