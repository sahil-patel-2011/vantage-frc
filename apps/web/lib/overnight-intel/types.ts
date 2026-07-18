// Overnight event-intel brief domain types. Pure data shapes — no I/O, no framework imports.
// A morning "what changed since last night" digest for the org's active event: newest
// research findings, EPA movement, and new scouting entries. Never fabricated — every
// highlight traces back to a real row in research_findings / team_event_metrics /
// match_scout_entries; absence of data means an empty list, not an invented one.

export type OvernightIntelResearchHighlight = {
  teamKey: string;
  teamNumber: number | null;
  title: string;
  summary: string;
  sourceType: string;
  sourceUrl: string;
  foundAt: string;
};

export type OvernightIntelEpaMover = {
  teamKey: string;
  teamNumber: number | null;
  previousEpa: number | null;
  currentEpa: number;
  /** currentEpa - previousEpa; null when there is no prior snapshot to diff against. */
  deltaEpa: number | null;
  previousCapturedAt: string | null;
};

export type OvernightIntelScoutingHighlight = {
  teamKey: string;
  teamNumber: number | null;
  newEntries: number;
  lastScoutedAt: string;
};

export type OvernightIntelBrief = {
  id: string;
  eventKey: string;
  seasonYear: number;
  briefDate: string;
  summary: string;
  researchHighlights: OvernightIntelResearchHighlight[];
  epaMovers: OvernightIntelEpaMover[];
  scoutingHighlights: OvernightIntelScoutingHighlight[];
  generatedAt: string;
};

export type OvernightIntelSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Raw "what changed" signals gathered from source tables before a brief is written. */
export type OvernightIntelSignals = {
  researchHighlights: OvernightIntelResearchHighlight[];
  epaMovers: OvernightIntelEpaMover[];
  scoutingHighlights: OvernightIntelScoutingHighlight[];
};
