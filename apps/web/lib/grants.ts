export const GRANT_STATUSES = ["identified", "drafting", "in_review", "submitted", "awarded", "declined"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];
export const GRANT_ITEM_KINDS = ["question", "essay", "attachment"] as const;
export type GrantItemKind = (typeof GRANT_ITEM_KINDS)[number];

const GRANT_STATUS_LABELS: Record<GrantStatus, string> = {
  identified: "Identified",
  drafting: "Drafting",
  in_review: "In review",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
};

export function grantStatusLabel(status: GrantStatus) {
  return GRANT_STATUS_LABELS[status];
}

export function validateGrantOpportunityInput(input: {
  name?: string;
  funder?: string;
  amountMinUsd?: number | null;
  amountMaxUsd?: number | null;
}): { ok: true; value: { name: string; funder: string | null } } | { ok: false; error: string } {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Grant name is required" };
  if (input.amountMinUsd != null && input.amountMaxUsd != null && input.amountMinUsd > input.amountMaxUsd) {
    return { ok: false, error: "Minimum amount cannot exceed maximum amount" };
  }
  return { ok: true, value: { name, funder: input.funder?.trim() || null } };
}

export function summarizeGrantHistory(applications: { status: GrantStatus; amountAwardedUsd: number | null }[]) {
  const awarded = applications.filter((a) => a.status === "awarded");
  return {
    totalApplications: applications.length,
    totalAwarded: awarded.length,
    totalAwardedUsd: Math.round(awarded.reduce((sum, a) => sum + (a.amountAwardedUsd ?? 0), 0) * 100) / 100,
  };
}
