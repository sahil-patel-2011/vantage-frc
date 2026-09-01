// Knowledge-gap detective domain types. Pure data shapes — no I/O, no framework imports.
// Scans the real wiki (knowledge_pages) against canonical work items (todos, build tasks,
// milestones) and lists only undocumented work that already exists. Never invents gaps.

import type { WorkItemSource, WorkItemStatus } from "../work-items/types";

/**
 * Native work-item sources persisted on knowledge_gap_items.subject_kind
 * after 0507_knowledge_gap_work_kinds.sql. Never DEMO placeholders.
 */
export const KNOWLEDGE_GAP_WORK_KINDS = ["todo", "build_task", "milestone"] as const;
export type KnowledgeGapWorkKind = (typeof KNOWLEDGE_GAP_WORK_KINDS)[number];

/**
 * Scan-helper / client badge aliases. findKnowledgeGaps still emits these;
 * compute maps them onto KnowledgeGapWorkKind for INSERT and maps persisted
 * rows back on read so knowledge-client SUBJECT_TONE stays valid.
 */
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

/** Slim work-item projection the detector diffs. Status/source come from the canonical adapter. */
export type KnowledgeGapWorkItem = {
  id: string;
  source: WorkItemSource;
  title: string;
  status: WorkItemStatus;
  grouping: string | null;
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
  /** Deep link back to the work tracker. Null when the row has no subject id. */
  href: string | null;
};

export type KnowledgeGapScan = {
  id: string;
  seasonYear: number;
  /** Eligible build tasks in this scan (maps to knowledge_gap_scans.subsystem_count). */
  subsystemCount: number;
  /** Eligible to-dos in this scan (maps to knowledge_gap_scans.decision_count). */
  decisionCount: number;
  /** Eligible milestones in this scan (maps to knowledge_gap_scans.event_count). */
  eventCount: number;
  pageCount: number;
  gapCount: number;
  coverageScore: number;
  summary: string;
  createdAt: string;
};
