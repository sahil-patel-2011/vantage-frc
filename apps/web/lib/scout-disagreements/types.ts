// Scout Disagreements domain types. Pure data shapes — no I/O, no framework imports.
// A "disagreement" is a single scouted field (e.g. auto-mobility, climb result) where two or
// more scouts logged conflicting values for the same match/team. Leads resolve it to a single
// authoritative value; every state change is appended to an immutable audit trail.

export type ScoutDisagreementStatus = "open" | "resolved" | "dismissed";

export type ScoutDisagreementAuditAction = "logged" | "resolved" | "dismissed" | "reopened";

export type ScoutDisagreementValue = {
  /** Scout name or identifying label for who reported this value. */
  source: string;
  value: string;
};

export type ScoutDisagreement = {
  id: string;
  seasonYear: number;
  eventKey: string | null;
  matchNumber: number;
  teamNumber: number;
  fieldKey: string;
  fieldLabel: string;
  values: ScoutDisagreementValue[];
  status: ScoutDisagreementStatus;
  resolvedValue: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type ScoutDisagreementAuditEntry = {
  id: string;
  disagreementId: string;
  action: ScoutDisagreementAuditAction;
  previousStatus: ScoutDisagreementStatus | null;
  newStatus: ScoutDisagreementStatus | null;
  resolvedValue: string | null;
  note: string | null;
  createdAt: string;
};

export type ScoutDisagreementSummary = {
  totalOpen: number;
  totalResolved: number;
  totalDismissed: number;
  distinctMatches: number;
  distinctFields: number;
};
