export type DeskSessionStatus = "draft" | "live" | "locked";
export type DeskPickSlot = "captain" | "first" | "second";
export type DeskEvidenceKind = "match_scout" | "pit_scout" | "note";
export type DeskConflictSeverity = "info" | "warn" | "block";

export type DeskSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
  done?: boolean;
};

export type DeskConflictFlag = {
  id: string;
  severity: DeskConflictSeverity;
  code: string;
  message: string;
  teamKey: string | null;
  allianceSeed: number | null;
  pickSlot: DeskPickSlot | null;
};

export type DeskEvidence = {
  id: string;
  slotId: string;
  sourceKind: DeskEvidenceKind;
  matchScoutEntryId: string | null;
  pitScoutEntryId: string | null;
  note: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
};

export type DeskSlot = {
  id: string;
  allianceSeed: number;
  pickSlot: DeskPickSlot;
  teamKey: string | null;
  teamNumber: number | null;
  nickname: string | null;
  rationale: string;
  sortOrder: number;
  /** Where this team sits on the ONE pick list — null when the board picked an unranked team. */
  pickListRank: number | null;
  pickListBucket: "first_pick" | "second_pick" | "avoid" | "unranked" | null;
  /** The justifier's source-cited "why", carried on the same row the board is showing. */
  justification: string | null;
  evidence: DeskEvidence[];
  matchScoutCount: number;
  pitScoutCount: number;
  tbaRank: number | null;
  tbaEpa: number | null;
  conflicts: DeskConflictFlag[];
};

export type DeskAlliance = {
  seed: number;
  slots: DeskSlot[];
};

export type DeskSessionSummary = {
  id: string;
  name: string;
  status: DeskSessionStatus;
  eventKey: string;
  updatedAt: string;
};

export type DeskExportSnapshot = {
  sessionId: string;
  sessionName: string;
  eventKey: string;
  eventName: string | null;
  status: DeskSessionStatus;
  alliances: Array<{
    seed: number;
    picks: Array<{
      pickSlot: DeskPickSlot;
      teamKey: string | null;
      teamNumber: number | null;
      nickname: string | null;
      rationale: string;
      evidenceNotes: string[];
      conflicts: string[];
    }>;
  }>;
  conflictCount: number;
  exportedAt: string;
};

export type DeskMember = {
  userId: string;
  name: string | null;
  email: string | null;
};
