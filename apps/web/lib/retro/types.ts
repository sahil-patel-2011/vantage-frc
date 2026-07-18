// Team Retrospective domain types. Pure data shapes — no I/O, no framework imports.
// A retro session captures structured start/stop/continue feedback with lightweight voting
// and tracked action items. The season postmortem is a separate, auto-compiled artifact built
// from this org's real decision/risk/incident/FMEA rows — never fabricated commentary.

export type RetroItemKind = "start" | "stop" | "continue";

export type RetroSessionStatus = "open" | "closed";

export type RetroActionStatus = "open" | "in_progress" | "done";

export type RetroItem = {
  id: string;
  sessionId: string;
  kind: RetroItemKind;
  content: string;
  authorName: string | null;
  voteCount: number;
  votedByMe: boolean;
  createdAt: string;
};

export type RetroActionItem = {
  id: string;
  sessionId: string;
  title: string;
  owner: string | null;
  status: RetroActionStatus;
  dueOn: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type RetroSession = {
  id: string;
  title: string;
  periodLabel: string;
  status: RetroSessionStatus;
  seasonYear: number;
  createdByName: string | null;
  createdAt: string;
  itemCounts: { start: number; stop: number; continue: number };
  actionOpenCount: number;
};

/** Counted (never fabricated) inputs feeding the auto-compiled season postmortem. */
export type RetroPostmortemCounts = {
  decisionsTotal: number;
  decisionsAccepted: number;
  decisionsRejected: number;
  risksTotal: number;
  risksOpen: number;
  risksClosed: number;
  incidentsTotal: number;
  incidentsBySeverity: Array<{ severity: string; count: number }>;
  fmeaFailuresTotal: number;
  fmeaTopFailures: Array<{ id: string; title: string; subsystemName: string; rpn: number; status: string }>;
  retroActionItemsTotal: number;
  retroActionItemsOpen: number;
};

export type RetroPostmortem = {
  id: string;
  seasonYear: number;
  narrative: string;
  counts: RetroPostmortemCounts;
  generatedByName: string | null;
  createdAt: string;
};
