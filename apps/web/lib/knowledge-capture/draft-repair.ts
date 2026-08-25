// Draft a wiki page from a RESOLVED pit_repair_triage_reports row (migration 0210).
// Deterministic: same row in, same markdown out. No AI, no invented facts.
//
// The numeric triage columns (severity, prior failures, minutes to next match) are real
// recorded values, so they are quoted as facts — but only when the row actually carries
// prose, because a page of numbers with no story is not institutional memory.

import { isPitRepairEligible } from "./eligibility";
import { captureSlug, captureTitle, cleanText, renderCaptureBody } from "./format";
import type { CaptureDraft, CaptureEvidence } from "./types";

export type PitRepairSource = {
  id: string;
  title: string;
  subsystemName: string | null;
  status: string;
  decision: string | null;
  symptomNote: string | null;
  rationale: string | null;
  severity: number | null;
  priorFailureCount: number | null;
  minutesUntilNextMatch: number | null;
  prestageRecommended: boolean | null;
  seasonYear: number | null;
};

const DECISION_LABEL: Record<string, string> = {
  fix: "Fix in place",
  swap: "Swap the part",
  monitor: "Monitor",
};

export function repairDecisionLabel(decision: string | null): string | null {
  const clean = cleanText(decision);
  if (!clean) return null;
  return DECISION_LABEL[clean] ?? clean;
}

export function repairEvidence(row: PitRepairSource): CaptureEvidence[] {
  const rows: Array<[string, unknown]> = [
    ["Symptom", row.symptomNote],
    ["Triage call", repairDecisionLabel(row.decision)],
    ["Rationale", row.rationale],
    ["Subsystem", row.subsystemName],
  ];
  return rows
    .map(([label, value]) => ({ label, text: cleanText(value) }))
    .filter((entry): entry is CaptureEvidence => entry.text !== null);
}

export function draftFromPitRepair(row: PitRepairSource): CaptureDraft | null {
  if (!isPitRepairEligible(row)) return null;

  const sourceTitle = cleanText(row.title);
  if (!sourceTitle) return null;

  const subsystem = cleanText(row.subsystemName);
  const title = captureTitle(
    subsystem ? `Pit repair — ${subsystem}: ${sourceTitle}` : `Pit repair — ${sourceTitle}`,
  );
  const body = renderCaptureBody({
    title,
    facts: [
      { label: "Source", value: "Pit repair triage (resolved)" },
      { label: "Subsystem", value: subsystem },
      { label: "Season", value: row.seasonYear === null ? null : String(row.seasonYear) },
      { label: "Triage call", value: repairDecisionLabel(row.decision) },
      {
        label: "Severity recorded",
        value: row.severity === null ? null : `${row.severity} of 10`,
      },
      {
        label: "Prior failures recorded",
        value: row.priorFailureCount === null ? null : String(row.priorFailureCount),
      },
      {
        label: "Minutes to next match",
        value: row.minutesUntilNextMatch === null ? null : String(row.minutesUntilNextMatch),
      },
      { label: "Pre-stage recommended", value: row.prestageRecommended ? "yes" : null },
    ],
    sections: [
      { heading: "Symptom", text: row.symptomNote },
      { heading: "Why we called it that way", text: row.rationale },
    ],
    provenance:
      "Drafted from the pit repair triage log. Every line above is text or a number a member recorded on that repair — nothing was generated. Edit before approving if anything is missing.",
  });

  return {
    title,
    slug: captureSlug("repair", subsystem ? `${subsystem} ${sourceTitle}` : sourceTitle, row.id),
    body,
    templateKind: "pit_ops",
    seasonYear: row.seasonYear,
  };
}
