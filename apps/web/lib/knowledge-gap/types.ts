// Knowledge-gap detective domain types. Pure data shapes — no I/O, no framework imports.
// Scans the wiki (knowledge_pages) / decision corpus (decision_records) against real
// subsystems (robot_subsystems) and real scouted events (match_scout_entries) and
// surfaces undocumented subjects, with an optional stub wiki page draft.

export type KnowledgeGapSubjectKind = "subsystem" | "decision" | "event";

export type KnowledgeGapStatus = "open" | "drafted" | "dismissed";

/** Mirrors the knowledge wiki's KnowledgeTemplateKind, kept local so this lib stays framework-free. */
export type KnowledgeGapTemplateKind =
  | "blank"
  | "season_handoff"
  | "subsystem"
  | "role_onboarding"
  | "pit_ops"
  | "software"
  | "cad_conventions"
  | "other";

export type KnowledgeGapSubsystem = {
  id: string;
  name: string;
  category: string;
  seasonYear: number;
};

export type KnowledgeGapDecision = {
  id: string;
  title: string;
  seasonYear: number;
};

export type KnowledgeGapEvent = {
  eventKey: string;
  name: string;
  seasonYear: number;
};

export type KnowledgeGapPage = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  seasonYear: number | null;
};

export type KnowledgeGapCandidate = {
  subjectKind: KnowledgeGapSubjectKind;
  subjectId: string;
  subjectRef: string;
  seasonYear: number;
  reason: string;
  suggestedTemplate: KnowledgeGapTemplateKind;
};

export type KnowledgeGapItem = {
  id: string;
  subjectKind: KnowledgeGapSubjectKind;
  subjectRef: string;
  subjectId: string | null;
  seasonYear: number;
  reason: string;
  suggestedTemplate: KnowledgeGapTemplateKind;
  status: KnowledgeGapStatus;
  draftPageId: string | null;
  createdAt: string;
};

export type KnowledgeGapScan = {
  id: string;
  seasonYear: number;
  subsystemCount: number;
  decisionCount: number;
  eventCount: number;
  pageCount: number;
  gapCount: number;
  coverageScore: number;
  summary: string;
  createdAt: string;
};
