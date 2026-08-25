// Draft a wiki page from a RESOLVED/CLOSED incident_reports row (migration 0121).
// Deterministic: same row in, same markdown out. No AI, no invented facts.

import { isIncidentReportEligible } from "./eligibility";
import { captureSlug, captureTitle, cleanText, renderCaptureBody } from "./format";
import type { CaptureDraft, CaptureEvidence } from "./types";

export type IncidentReportSource = {
  id: string;
  title: string;
  category: string | null;
  severity: string | null;
  status: string;
  occurredOn: string | null;
  location: string | null;
  description: string | null;
  correctiveAction: string | null;
  owner: string | null;
  seasonYear: number | null;
};

export function incidentEvidence(row: IncidentReportSource): CaptureEvidence[] {
  const rows: Array<[string, unknown]> = [
    ["What happened", row.description],
    ["Corrective action", row.correctiveAction],
    ["Severity", row.severity],
    ["Location", row.location],
    ["Owner", row.owner],
  ];
  return rows
    .map(([label, value]) => ({ label, text: cleanText(value) }))
    .filter((entry): entry is CaptureEvidence => entry.text !== null);
}

export function draftFromIncidentReport(row: IncidentReportSource): CaptureDraft | null {
  if (!isIncidentReportEligible(row)) return null;

  const sourceTitle = cleanText(row.title);
  if (!sourceTitle) return null;

  const title = captureTitle(`Safety incident — ${sourceTitle}`);
  const body = renderCaptureBody({
    title,
    facts: [
      { label: "Source", value: "Safety incident log (closed out)" },
      { label: "Category", value: row.category },
      { label: "Severity", value: row.severity },
      { label: "Occurred on", value: row.occurredOn },
      { label: "Location", value: row.location },
      { label: "Season", value: row.seasonYear === null ? null : String(row.seasonYear) },
      { label: "Owner", value: row.owner },
    ],
    sections: [
      { heading: "What happened", text: row.description },
      { heading: "Corrective action taken", text: row.correctiveAction },
    ],
    provenance:
      "Drafted from the team's safety incident log. Every line above is text a member recorded on that incident — nothing was generated. Edit before approving if anything is missing.",
  });

  return {
    title,
    slug: captureSlug("incident", sourceTitle, row.id),
    body,
    templateKind: "other",
    seasonYear: row.seasonYear,
  };
}
