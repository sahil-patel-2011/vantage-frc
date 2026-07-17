// Pure decision-log resolution + summary. Deterministic given its input. The interesting bit
// is supersession: an accepted decision can replace an earlier one, and the earlier record's
// effective status becomes "superseded" without mutating what was actually recorded.

import type {
  DecisionCategory,
  DecisionRecord,
  DecisionStatus,
  DecisionsSummary,
  ResolvedDecision,
} from "./types";

const CATEGORY_ORDER: DecisionCategory[] = ["design", "strategy", "build", "business", "process", "other"];
const ALL_STATUSES: DecisionStatus[] = ["proposed", "accepted", "rejected", "superseded"];

export function decisionCategoryLabel(category: DecisionCategory): string {
  const labels: Record<DecisionCategory, string> = {
    design: "Design",
    strategy: "Strategy",
    build: "Build",
    business: "Business",
    process: "Process",
    other: "Other",
  };
  return labels[category];
}

export function decisionStatusLabel(status: DecisionStatus): string {
  const labels: Record<DecisionStatus, string> = {
    proposed: "Proposed",
    accepted: "Accepted",
    rejected: "Rejected",
    superseded: "Superseded",
  };
  return labels[status];
}

function decidedKey(record: DecisionRecord): string {
  // Sort superseders by decision date (then creation) so the latest replacement wins.
  return `${record.decidedOn ?? "0000-00-00"}T${record.createdAt}`;
}

/**
 * Resolve supersession across the set: for each record, find the latest ACCEPTED decision that
 * declares it as the one it supersedes, and compute the effective status.
 */
export function resolveSupersession(records: DecisionRecord[]): ResolvedDecision[] {
  const byId = new Map(records.map((record) => [record.id, record]));

  // supersededId -> the accepted record that replaces it (latest wins).
  const replacedBy = new Map<string, DecisionRecord>();
  for (const record of records) {
    if (record.status !== "accepted" || !record.supersedesId) continue;
    if (!byId.has(record.supersedesId)) continue;
    const existing = replacedBy.get(record.supersedesId);
    if (!existing || decidedKey(record) > decidedKey(existing)) {
      replacedBy.set(record.supersedesId, record);
    }
  }

  return records.map((record) => {
    const superseder = replacedBy.get(record.id) ?? null;
    const effectiveStatus: DecisionStatus =
      record.status === "superseded"
        ? "superseded"
        : superseder && record.status === "accepted"
          ? "superseded"
          : record.status;
    return {
      ...record,
      supersededById: superseder?.id ?? null,
      supersededByTitle: superseder?.title ?? null,
      effectiveStatus,
    };
  });
}

export function summarizeDecisions(records: DecisionRecord[]): DecisionsSummary {
  const resolved = resolveSupersession(records);

  const byStatus = ALL_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {} as Record<DecisionStatus, number>,
  );
  for (const record of resolved) byStatus[record.effectiveStatus] += 1;

  const catMap = new Map<DecisionCategory, number>();
  for (const record of resolved) catMap.set(record.category, (catMap.get(record.category) ?? 0) + 1);
  const byCategory = [...catMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  const open = resolved
    .filter((record) => record.effectiveStatus === "proposed")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const recent = resolved
    .filter((record) => record.effectiveStatus === "accepted" || record.effectiveStatus === "rejected")
    .sort((a, b) => (b.decidedOn ?? "").localeCompare(a.decidedOn ?? "") || b.createdAt.localeCompare(a.createdAt));

  return {
    total: records.length,
    byStatus,
    byCategory,
    open,
    recent,
    supersededCount: byStatus.superseded,
  };
}
