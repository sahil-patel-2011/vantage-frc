// Draft a wiki page from an ACCEPTED decision_records row (migration 0101).
// Deterministic: same row in, same markdown out. No AI, no invented facts.

import { isDecisionRecordEligible } from "./eligibility";
import { bulletList, captureSlug, captureTitle, cleanText, renderCaptureBody } from "./format";
import type { CaptureDraft, CaptureEvidence } from "./types";

export type DecisionRecordSource = {
  id: string;
  title: string;
  category: string | null;
  status: string;
  context: string | null;
  decision: string | null;
  rationale: string | null;
  options: unknown;
  decidedOn: string | null;
  deciders: string | null;
  seasonYear: number | null;
};

/**
 * `options` is jsonb, so it can be anything. Only shapes that carry a readable label are
 * used; everything else is dropped rather than stringified into noise.
 */
export function decisionOptionLines(options: unknown): string | null {
  if (!Array.isArray(options)) return null;
  const labels = options.map((option) => {
    if (typeof option === "string") return cleanText(option);
    if (option && typeof option === "object") {
      const record = option as Record<string, unknown>;
      const label =
        cleanText(record.label) ??
        cleanText(record.name) ??
        cleanText(record.option) ??
        cleanText(record.title);
      if (!label) return null;
      const note = cleanText(record.notes) ?? cleanText(record.note);
      return note ? `${label} — ${note}` : label;
    }
    return null;
  });
  return bulletList(labels);
}

export function decisionEvidence(row: DecisionRecordSource): CaptureEvidence[] {
  const rows: Array<[string, unknown]> = [
    ["Context", row.context],
    ["Decision", row.decision],
    ["Rationale", row.rationale],
    ["Options considered", decisionOptionLines(row.options)],
    ["Deciders", row.deciders],
  ];
  return rows
    .map(([label, value]) => ({ label, text: cleanText(value) }))
    .filter((entry): entry is CaptureEvidence => entry.text !== null);
}

export function draftFromDecisionRecord(row: DecisionRecordSource): CaptureDraft | null {
  if (!isDecisionRecordEligible(row)) return null;

  const sourceTitle = cleanText(row.title);
  if (!sourceTitle) return null;

  const title = captureTitle(`Decision — ${sourceTitle}`);
  const body = renderCaptureBody({
    title,
    facts: [
      { label: "Source", value: "Decision log (accepted)" },
      { label: "Category", value: row.category },
      { label: "Season", value: row.seasonYear === null ? null : String(row.seasonYear) },
      { label: "Decided on", value: row.decidedOn },
      { label: "Deciders", value: row.deciders },
    ],
    sections: [
      { heading: "Context", text: row.context },
      { heading: "What we decided", text: row.decision },
      { heading: "Why", text: row.rationale },
      { heading: "Options considered", text: decisionOptionLines(row.options) },
    ],
    provenance:
      "Drafted from the team's decision log. Every line above is text a member recorded on that decision — nothing was generated. Edit before approving if anything is missing.",
  });

  return {
    title,
    slug: captureSlug("decision", sourceTitle, row.id),
    body,
    templateKind: "other",
    seasonYear: row.seasonYear,
  };
}
