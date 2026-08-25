// Capture-from-work knowledge drafts (migration 0476). Framework-free, no DB imports.
//
// A draft is a PROPOSAL. It only ever becomes a knowledge_pages row when a human presses
// Approve on /knowledge-drafts, so every type here is deliberately named "proposed".

import type { KnowledgeTemplateKind } from "../knowledge/types";

export const CAPTURE_SOURCE_KINDS = [
  "decision_record",
  "incident_report",
  "pit_repair_triage",
] as const;
export type CaptureSourceKind = (typeof CAPTURE_SOURCE_KINDS)[number];

export const CAPTURE_SOURCE_LABEL: Record<CaptureSourceKind, string> = {
  decision_record: "Decision log",
  incident_report: "Safety incident",
  pit_repair_triage: "Pit repair",
};

/** Where a member can go to read the source row this draft was built from. */
export const CAPTURE_SOURCE_HREF: Record<CaptureSourceKind, string> = {
  decision_record: "/decisions",
  incident_report: "/safety",
  pit_repair_triage: "/pit-repair-triage",
};

export const CAPTURE_DRAFT_STATUSES = ["draft", "approved", "dismissed"] as const;
export type CaptureDraftStatus = (typeof CAPTURE_DRAFT_STATUSES)[number];

/** The deterministic proposal a source row produces. `null` means "not enough recorded". */
export type CaptureDraft = {
  title: string;
  slug: string;
  body: string;
  templateKind: KnowledgeTemplateKind;
  seasonYear: number | null;
};

/** One quoted line of the source row, shown beside the proposal in the review queue. */
export type CaptureEvidence = {
  label: string;
  text: string;
};

export type CaptureCandidate = {
  sourceKind: CaptureSourceKind;
  sourceId: string;
  sourceTitle: string;
  sourceStatus: string;
  sourceDate: string | null;
  seasonYear: number | null;
  evidence: CaptureEvidence[];
  proposedTitle: string;
};

export type CaptureDraftRecord = {
  id: string;
  sourceKind: CaptureSourceKind;
  sourceId: string;
  sourceTitle: string | null;
  proposedTitle: string;
  proposedSlug: string;
  proposedBody: string;
  templateKind: KnowledgeTemplateKind;
  seasonYear: number | null;
  status: CaptureDraftStatus;
  knowledgePageId: string | null;
  dismissedReason: string | null;
  evidence: CaptureEvidence[];
  createdAt: string;
  reviewedAt: string | null;
};

export function captureSourceLabel(kind: CaptureSourceKind): string {
  return CAPTURE_SOURCE_LABEL[kind] ?? kind;
}

export function isCaptureSourceKind(value: unknown): value is CaptureSourceKind {
  return typeof value === "string" && (CAPTURE_SOURCE_KINDS as readonly string[]).includes(value);
}
