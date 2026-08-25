// The ONE pick list. Every pick-list surface (collaborative ranking, alliance-selection desk,
// Pick Clock, justifier) reads and writes these shapes through lib/picklist/store.ts, which is
// backed by the pick_lists / pick_list_entries / pick_list_entry_votes spine (migration 0454).
//
// Pure data shapes only — no I/O, no framework imports, safe to import from tests and clients.

/** Shared tier vocabulary. `avoid` sorts last; `unranked` is the honest default. */
export type PickBucket = "first_pick" | "second_pick" | "avoid" | "unranked";

export type PickListStatus = "open" | "locked" | "archived";

export type PickListSource =
  | "manual"
  | "picklist_collab"
  | "alliance_desk"
  | "strategy"
  | "intel_research";

/** Where a team ended up on Saturday's draft board. */
export type DraftPickSlot = "captain" | "first" | "second";

export type PickListVote = {
  id: string;
  voterId: string;
  voterName: string | null;
  /** 0.1–5. A lead strategist's read can weigh more than a rookie's. */
  weight: number;
  rankSuggestion: number | null;
  comment: string | null;
  updatedAt: string;
};

export type JustificationSource = {
  kind: string;
  label: string;
  detail: string;
};

export type PickListEntry = {
  id: string;
  pickListId: string;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  /** Dense 1..n across the whole list — normalized after every reorder. */
  rank: number;
  bucket: PickBucket;
  /** Legacy free-text tier kept in sync for Strategy / Intel-Research consumers. */
  tier: string | null;
  notes: string | null;
  addedBy: string | null;
  updatedBy: string | null;
  /** Shown as "updated by X" so a losing concurrent reorder is visible, not silent. */
  updatedByName: string | null;
  updatedAt: string;
  revision: number;
  votes: PickListVote[];
  weightedScore: number;
  averageRankSuggestion: number | null;
  justification: string | null;
  justificationSources: JustificationSource[];
  justificationContradiction: boolean;
  justificationReason: string | null;
  justificationGeneratedAt: string | null;
  draftedAllianceSeed: number | null;
  draftedPickSlot: DraftPickSlot | null;
  draftedAt: string | null;
  boardRationale: string;
};

export type PickListRecord = {
  id: string;
  orgId: string;
  eventKey: string;
  name: string;
  seasonYear: number | null;
  status: PickListStatus;
  source: PickListSource;
  /** Free-form draft-board scratch (who is on the clock, which alliance is ours). */
  boardState: Record<string, unknown>;
  createdBy: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
  revision: number;
  entryCount: number;
};

export type PickListSnapshot = {
  list: PickListRecord;
  entries: PickListEntry[];
};

/** A board slot as projected from the spine — the desk renders these, it no longer owns them. */
export type BoardSlot = {
  allianceSeed: number;
  pickSlot: DraftPickSlot;
  entryId: string | null;
  teamKey: string | null;
  teamNumber: number | null;
  nickname: string | null;
  rank: number | null;
  bucket: PickBucket | null;
  rationale: string;
  justification: string | null;
  draftedAt: string | null;
};

export type BoardStateView = {
  pickListId: string;
  eventKey: string;
  slots: BoardSlot[];
  /** Team keys already off the board — what Pick Clock must exclude. */
  draftedTeamKeys: string[];
  updatedAt: string;
};

export type ReorderConflict = {
  code: "stale_revision";
  message: string;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
  /** The revision the caller thought it was editing. */
  expectedRevision: number;
  actualRevision: number;
};
