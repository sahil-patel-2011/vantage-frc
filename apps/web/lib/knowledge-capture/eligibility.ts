// Which finished work is allowed to propose a wiki page.
//
// Two gates, both deliberate:
//   1. FINISHED — only an accepted decision, a resolved/closed incident, or a resolved
//      repair. Drafting from work still in flight documents a guess, not a decision.
//   2. SUBSTANTIVE — the row must actually carry prose. A record whose narrative fields
//      are all blank has nothing to say, so it produces no draft and the queue shows an
//      honest "not enough recorded yet" instead of a page of empty headings.

import { cleanText } from "./format";

/** Decision statuses a draft may be built from. */
export const DRAFTABLE_DECISION_STATUSES = ["accepted"] as const;
/** Incident statuses that count as closed out. */
export const DRAFTABLE_INCIDENT_STATUSES = ["resolved", "closed"] as const;
/** Pit repair statuses that count as closed out. */
export const DRAFTABLE_REPAIR_STATUSES = ["resolved"] as const;

function has(...values: Array<unknown>): boolean {
  return values.some((value) => cleanText(value) !== null);
}

export function isDecisionRecordEligible(row: {
  title?: unknown;
  status?: unknown;
  context?: unknown;
  rationale?: unknown;
}): boolean {
  if (!has(row.title)) return false;
  if (!(DRAFTABLE_DECISION_STATUSES as readonly string[]).includes(String(row.status))) {
    return false;
  }
  // Spec: no context AND no rationale drafts nothing. The bare "we chose X" line is a
  // log entry, not institutional memory.
  return has(row.context, row.rationale);
}

export function isIncidentReportEligible(row: {
  title?: unknown;
  status?: unknown;
  description?: unknown;
  correctiveAction?: unknown;
}): boolean {
  if (!has(row.title)) return false;
  if (!(DRAFTABLE_INCIDENT_STATUSES as readonly string[]).includes(String(row.status))) {
    return false;
  }
  return has(row.description, row.correctiveAction);
}

export function isPitRepairEligible(row: {
  title?: unknown;
  status?: unknown;
  symptomNote?: unknown;
  rationale?: unknown;
}): boolean {
  if (!has(row.title)) return false;
  if (!(DRAFTABLE_REPAIR_STATUSES as readonly string[]).includes(String(row.status))) {
    return false;
  }
  return has(row.symptomNote, row.rationale);
}

/** Human sentence for why a source produced no draft. Shown verbatim in the queue. */
export function ineligibleReason(kind: "decision_record" | "incident_report" | "pit_repair_triage"): string {
  if (kind === "decision_record") {
    return "Accepted decisions with a recorded context or rationale become drafts. This one has neither yet.";
  }
  if (kind === "incident_report") {
    return "Resolved incidents with a recorded description or corrective action become drafts. This one has neither yet.";
  }
  return "Resolved repairs with a recorded symptom or rationale become drafts. This one has neither yet.";
}
