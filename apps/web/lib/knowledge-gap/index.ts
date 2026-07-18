// Pure, framework-free helpers for the knowledge-gap detective. No I/O here — DB access
// lives in compute-knowledge-gap.ts.

import type {
  KnowledgeGapCandidate,
  KnowledgeGapDecision,
  KnowledgeGapEvent,
  KnowledgeGapPage,
  KnowledgeGapSubjectKind,
  KnowledgeGapSubsystem,
  KnowledgeGapTemplateKind,
} from "./types";

export const KNOWLEDGE_GAP_SUBJECT_KINDS: KnowledgeGapSubjectKind[] = ["subsystem", "decision", "event"];

export function knowledgeGapSubjectLabel(kind: KnowledgeGapSubjectKind): string {
  switch (kind) {
    case "subsystem":
      return "Subsystem";
    case "decision":
      return "Decision";
    case "event":
      return "Event";
    default:
      return kind;
  }
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/** A subject is "covered" when any wiki page's title/body/tags mentions its name. */
function isCoveredByPages(name: string, haystacks: string[]): boolean {
  const needle = normalize(name);
  if (!needle) return true;
  return haystacks.some((text) => text.includes(needle));
}

/**
 * Deterministically diffs the real subsystem / decision / event corpus against the wiki
 * page corpus and returns undocumented subjects. Pure function — safe to unit test with
 * mock rows and reused by the metered scan in compute-knowledge-gap.ts.
 */
export function findKnowledgeGaps(input: {
  subsystems: KnowledgeGapSubsystem[];
  decisions: KnowledgeGapDecision[];
  events: KnowledgeGapEvent[];
  pages: KnowledgeGapPage[];
}): KnowledgeGapCandidate[] {
  const haystacks = input.pages.map((page) =>
    normalize(`${page.title} ${page.body} ${page.tags.join(" ")}`),
  );

  const gaps: KnowledgeGapCandidate[] = [];

  for (const subsystem of input.subsystems) {
    if (isCoveredByPages(subsystem.name, haystacks)) continue;
    gaps.push({
      subjectKind: "subsystem",
      subjectId: subsystem.id,
      subjectRef: subsystem.name,
      seasonYear: subsystem.seasonYear,
      reason: `No wiki page mentions the "${subsystem.name}" (${subsystem.category}) subsystem.`,
      suggestedTemplate: "subsystem",
    });
  }

  for (const decision of input.decisions) {
    if (isCoveredByPages(decision.title, haystacks)) continue;
    gaps.push({
      subjectKind: "decision",
      subjectId: decision.id,
      subjectRef: decision.title,
      seasonYear: decision.seasonYear,
      reason: `Decision "${decision.title}" has no linked wiki page explaining it to future members.`,
      suggestedTemplate: "blank",
    });
  }

  for (const event of input.events) {
    if (isCoveredByPages(event.name, haystacks)) continue;
    gaps.push({
      subjectKind: "event",
      subjectId: event.eventKey,
      subjectRef: event.name,
      seasonYear: event.seasonYear,
      reason: `Team has scouted matches at "${event.name}" but has no season-handoff notes for it.`,
      suggestedTemplate: "season_handoff",
    });
  }

  return gaps;
}

/** 0..1 share of tracked subjects that already have wiki coverage. 1 when there is nothing to track. */
export function computeCoverageScore(totalSubjects: number, gapCount: number): number {
  if (totalSubjects <= 0) return 1;
  const covered = Math.max(0, totalSubjects - gapCount);
  return Math.max(0, Math.min(1, Math.round((covered / totalSubjects) * 10000) / 10000));
}

export function summarizeScan(input: { totalSubjects: number; gapCount: number; coverageScore: number }): string {
  if (input.totalSubjects <= 0) {
    return "No subsystems, decisions, or scouted events yet — nothing to check documentation against.";
  }
  if (input.gapCount === 0) {
    return `All ${input.totalSubjects} tracked subject(s) have wiki coverage.`;
  }
  return `${input.gapCount} of ${input.totalSubjects} tracked subject(s) have no wiki coverage (${Math.round(
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
      ? `## ${input.subjectRef} subsystem`
      : input.subjectKind === "decision"
        ? `## Decision: ${input.subjectRef}`
        : `## Event: ${input.subjectRef}`;
  return [
    "_Stub page drafted by Knowledge-gap detective — fill this in._",
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
  const prefix = kind === "subsystem" ? "Subsystem" : kind === "decision" ? "Decision" : "Event";
  return `${prefix}: ${ref}`.slice(0, 200);
}

export function templateKindFor(kind: KnowledgeGapSubjectKind): KnowledgeGapTemplateKind {
  if (kind === "subsystem") return "subsystem";
  if (kind === "event") return "season_handoff";
  return "blank";
}
