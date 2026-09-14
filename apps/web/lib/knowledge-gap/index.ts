// Pure, framework-free helpers for the knowledge-gap detective. No I/O here — DB access
// lives in compute-knowledge-gap.ts.

import type { WorkItemSource } from "../work-items/types";
import type {
  KnowledgeGapCandidate,
  KnowledgeGapPage,
  KnowledgeGapSubjectKind,
  KnowledgeGapTemplateKind,
  KnowledgeGapWorkItem,
} from "./types";

export const KNOWLEDGE_GAP_SUBJECT_KINDS: KnowledgeGapSubjectKind[] = ["subsystem", "decision", "event"];

/** Work-item source → persisted subject_kind (CHECK constraint on knowledge_gap_items). */
export const WORK_SOURCE_SUBJECT_KIND: Record<WorkItemSource, KnowledgeGapSubjectKind> = {
  build_task: "subsystem",
  todo: "decision",
  milestone: "event",
};

const WORK_SOURCE_TEMPLATE: Record<WorkItemSource, KnowledgeGapTemplateKind> = {
  build_task: "subsystem",
  todo: "blank",
  milestone: "season_handoff",
};

const SUBJECT_KIND_WORK_SOURCE: Record<KnowledgeGapSubjectKind, WorkItemSource> = {
  subsystem: "build_task",
  decision: "todo",
  event: "milestone",
};

export function knowledgeGapSubjectLabel(kind: KnowledgeGapSubjectKind): string {
  switch (kind) {
    case "subsystem":
      return "Build task";
    case "decision":
      return "To-do";
    case "event":
      return "Milestone";
    default:
      return kind;
  }
}

export function workSourceForSubjectKind(kind: KnowledgeGapSubjectKind): WorkItemSource {
  return SUBJECT_KIND_WORK_SOURCE[kind];
}

export function subjectKindForWorkSource(source: WorkItemSource): KnowledgeGapSubjectKind {
  return WORK_SOURCE_SUBJECT_KIND[source];
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/** A work item is "covered" when any wiki page's title/body/tags mentions its title. */
function isCoveredByPages(name: string, haystacks: string[]): boolean {
  const needle = normalize(name);
  if (!needle) return true;
  return haystacks.some((text) => text.includes(needle));
}

/**
 * Dropped work was never done; blank titles cannot be documented without inventing a name.
 * Everything else that already exists on a tracker is eligible to be a gap.
 */
export function isEligibleWorkItem(item: KnowledgeGapWorkItem): boolean {
  if (item.status === "dropped") return false;
  return Boolean(item.title.trim());
}

function undocumentedReason(item: KnowledgeGapWorkItem): string {
  const title = item.title.trim();
  const grouping = item.grouping?.trim();
  const suffix = grouping ? ` (${grouping})` : "";
  switch (item.source) {
    case "todo":
      return `To-do "${title}"${suffix} has no wiki page documenting the work.`;
    case "build_task":
      return `Build task "${title}"${suffix} has no wiki page documenting the work.`;
    case "milestone":
      return `Milestone "${title}"${suffix} has no wiki page documenting the work.`;
  }
}

/**
 * Diffs real work items against the real wiki. Returns only undocumented work that
 * already exists on a tracker — never invents DEMO subjects, never pads empty orgs.
 */
export function findKnowledgeGaps(input: {
  workItems: KnowledgeGapWorkItem[];
  pages: KnowledgeGapPage[];
  seasonYear: number;
}): KnowledgeGapCandidate[] {
  const haystacks = input.pages.map((page) =>
    normalize(`${page.title} ${page.body} ${page.tags.join(" ")}`),
  );

  const gaps: KnowledgeGapCandidate[] = [];
  for (const item of input.workItems) {
    if (!isEligibleWorkItem(item)) continue;
    if (isCoveredByPages(item.title, haystacks)) continue;
    gaps.push({
      subjectKind: WORK_SOURCE_SUBJECT_KIND[item.source],
      subjectId: item.id,
      subjectRef: item.title.trim(),
      seasonYear: input.seasonYear,
      reason: undocumentedReason(item),
      suggestedTemplate: WORK_SOURCE_TEMPLATE[item.source],
    });
  }
  return gaps;
}

export function countEligibleWorkBySource(items: KnowledgeGapWorkItem[]): {
  todos: number;
  buildTasks: number;
  milestones: number;
  total: number;
} {
  let todos = 0;
  let buildTasks = 0;
  let milestones = 0;
  for (const item of items) {
    if (!isEligibleWorkItem(item)) continue;
    if (item.source === "todo") todos += 1;
    else if (item.source === "build_task") buildTasks += 1;
    else milestones += 1;
  }
  return { todos, buildTasks, milestones, total: todos + buildTasks + milestones };
}

/** 0..1 share of tracked work that already has wiki coverage. 1 when there is nothing to track. */
export function computeCoverageScore(totalSubjects: number, gapCount: number): number {
  if (totalSubjects <= 0) return 1;
  const covered = Math.max(0, totalSubjects - gapCount);
  return Math.max(0, Math.min(1, Math.round((covered / totalSubjects) * 10000) / 10000));
}

export function summarizeScan(input: { totalSubjects: number; gapCount: number; coverageScore: number }): string {
  if (input.totalSubjects <= 0) {
    return "No work items yet — nothing to check documentation against.";
  }
  if (input.gapCount === 0) {
    return `All ${input.totalSubjects} work item(s) have wiki coverage.`;
  }
  return `${input.gapCount} of ${input.totalSubjects} work item(s) have no wiki coverage (${Math.round(
    input.coverageScore * 100,
  )}% documented).`;
}

const SLUG_MAX = 120;

/** Wiki-safe slug: lowercase, dash-separated, matches knowledge_pages_slug_format. */
export function slugifyGapTitle(title: string, suffix: string): string {
  const base = normalize(title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const tail = suffix.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12);
  const combined = tail ? `${base}-${tail}` : base;
  const cleaned = combined.replace(/-+/g, "-").slice(0, SLUG_MAX).replace(/^-+|-+$/g, "");
  return cleaned || `page-${tail || "gap"}`;
}

/** Draft stub body for a new wiki page created from a knowledge-gap item — clearly marked as a stub. */
export function buildStubPageBody(input: {
  subjectKind: KnowledgeGapSubjectKind;
  subjectRef: string;
  reason: string;
  seasonYear: number;
}): string {
  const heading =
    input.subjectKind === "subsystem"
      ? `## ${input.subjectRef}`
      : input.subjectKind === "decision"
        ? `## To-do: ${input.subjectRef}`
        : `## Milestone: ${input.subjectRef}`;
  return [
    "_Stub page drafted from Knowledge gaps — fill this in._",
    "",
    heading,
    "",
    `Season: ${input.seasonYear}`,
    "",
    `Why this page exists: ${input.reason}`,
    "",
    "### Notes",
    "",
    "- TODO",
  ].join("\n");
}

export function stubTitleFor(kind: KnowledgeGapSubjectKind, ref: string): string {
  const prefix = kind === "subsystem" ? "Build task" : kind === "decision" ? "To-do" : "Milestone";
  return `${prefix}: ${ref}`.slice(0, 200);
}

export function templateKindFor(kind: KnowledgeGapSubjectKind): KnowledgeGapTemplateKind {
  if (kind === "subsystem") return "subsystem";
  if (kind === "event") return "season_handoff";
  return "blank";
}
