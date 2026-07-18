// Types for the Pick-list auto-justifier & contradiction guard.
// A "slot" is one pick_list_entries row (a ranked team on an org's pick list).
// For each slot we synthesize a source-cited rationale from TBA-sourced
// team_event_metrics (hard_metric) and this org's own match_scout_entries
// (scout_observation), and flag slots whose scouting story is contradicted
// by the team's official TBA match record.

export type PicklistSourceKind = "hard_metric" | "scout_observation";

export type PicklistSourceRef = {
  kind: PicklistSourceKind;
  label: string;
  detail: string;
};

export type PicklistContradiction = {
  flagged: boolean;
  reason: string | null;
};

export type PicklistTbaMetrics = {
  epaTotal: number | null;
  rank: number | null;
  wins: number;
  losses: number;
  ties: number;
  source: string;
} | null;

export type PicklistScoutSummary = {
  entryCount: number;
  avgConfidenceScore: number | null;
  lowConfidenceCount: number;
};

export type JustificationInput = {
  teamKey: string;
  teamNumber: number | null;
  rank: number;
  tier: string | null;
  tba: PicklistTbaMetrics;
  scout: PicklistScoutSummary;
};

export type ComputedJustification = {
  rationale: string;
  sources: PicklistSourceRef[];
  contradiction: PicklistContradiction;
};

export type JustifiedEntry = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  rank: number;
  tier: string | null;
  notes: string | null;
  scoutEntryCount: number;
  tbaAvailable: boolean;
  rationale: string | null;
  sources: PicklistSourceRef[];
  contradiction: PicklistContradiction | null;
  generatedAt: string | null;
};

export type PickListSummary = {
  id: string;
  name: string;
  eventKey: string;
  entryCount: number;
  updatedAt: string;
};

export type PicklistJustifierSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type PicklistJustifierView =
  | {
      status: "setup_required";
      message: string;
      steps: PicklistJustifierSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      pickLists: PickListSummary[];
      selectedPickListId: string | null;
      eventKey: string | null;
      entries: JustifiedEntry[];
      contradictionCount: number;
      computedAt: string;
    };
