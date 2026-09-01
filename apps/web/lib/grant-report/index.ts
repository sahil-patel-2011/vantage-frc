// Pure, unit-testable helpers for the Grant Report feature. No I/O, no framework imports.

import type {
  GrantReportOutreachLine,
  GrantReportSection,
  GrantReportSpendLine,
} from "./types";

export function outreachKindLabel(kind: string): string {
  switch (kind) {
    case "thank_you":
      return "Thank-you";
    case "renewal_ask":
      return "Renewal ask";
    case "new_prospect_intro":
      return "Prospect intro";
    case "grant_followup":
      return "Grant follow-up";
    case "custom":
      return "Custom";
    default:
      return kind;
  }
}

export type SpendTxnRow = { category: string; amountUsd: number };

export const GRANT_SPEND_SCHEMA_BLOCKER =
  "Grant spend needs a grant_finance_allocations table with org_id, grant_application_id, finance_transaction_id, amount_usd, created_by, timestamps, a unique grant/transaction key, and org-scoped RLS. finance_transactions currently has no grant linkage or allocation metadata.";

export function grantAllocationFromMetadata(
  metadata: unknown,
  grantApplicationId: string,
): { amountUsd: number; category: string } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const row = metadata as Record<string, unknown>;
  if (row.grantApplicationId !== grantApplicationId) return null;
  const amountUsd = Number(row.allocatedAmountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  return {
    amountUsd: Math.round(amountUsd * 100) / 100,
    category: typeof row.category === "string" && row.category.trim() ? row.category.trim() : "Uncategorized",
  };
}

/** Aggregate raw finance transaction rows into per-category totals, sorted by spend descending. */
export function summarizeSpend(rows: SpendTxnRow[]): GrantReportSpendLine[] {
  const byCategory = new Map<string, { totalUsd: number; count: number }>();
  for (const row of rows) {
    const key = row.category || "Uncategorized";
    const existing = byCategory.get(key) ?? { totalUsd: 0, count: 0 };
    existing.totalUsd += row.amountUsd;
    existing.count += 1;
    byCategory.set(key, existing);
  }
  return Array.from(byCategory.entries())
    .map(([category, agg]) => ({ category, totalUsd: Math.round(agg.totalUsd * 100) / 100, count: agg.count }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
}

export type OutreachRow = { kind: string };

/** Aggregate raw outreach-message rows into per-kind counts, sorted by count descending. */
export function summarizeOutreach(rows: OutreachRow[]): GrantReportOutreachLine[] {
  const byKind = new Map<string, number>();
  for (const row of rows) {
    byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
  }
  return Array.from(byKind.entries())
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Build the deterministic report sections + narrative from only what was recorded: the awarded
 * amount, logged outreach to the funder/sponsor, and recorded spend. Skips any section that has
 * no underlying data rather than inventing figures.
 */
export function buildGrantReportSections(input: {
  grantName: string;
  funder: string | null;
  seasonYear: number;
  amountAwardedUsd: number;
  outreachByKind: GrantReportOutreachLine[];
  spendByCategory: GrantReportSpendLine[];
  spendAttribution?: "explicit" | "setup_required";
}): GrantReportSection[] {
  const sections: GrantReportSection[] = [];

  sections.push({
    id: "award",
    title: "Award summary",
    body: `${input.grantName}${input.funder ? ` (${input.funder})` : ""} awarded $${input.amountAwardedUsd.toLocaleString()} for the ${input.seasonYear} season.`,
  });

  const outreachCount = input.outreachByKind.reduce((sum, line) => sum + line.count, 0);
  if (outreachCount > 0) {
    const parts = input.outreachByKind.map((line) => `${line.count} ${outreachKindLabel(line.kind).toLowerCase()}`);
    sections.push({
      id: "outreach",
      title: "Funder communication",
      body: `The team logged ${outreachCount} outreach message(s) related to this grant: ${parts.join(", ")}.`,
    });
  }

  const linkageNote =
    "Spend linkage is not configured — only explicitly grant-linked allocations can count, and no safe allocation field exists in the current Finance schema.";
  const totalSpendUsd = input.spendByCategory.reduce((sum, line) => sum + line.totalUsd, 0);
  if (input.spendAttribution === "explicit") {
    if (totalSpendUsd > 0) {
      const parts = input.spendByCategory
        .slice(0, 6)
        .map((line) => `${line.category}: $${line.totalUsd.toLocaleString()} (${line.count} txn)`);
      sections.push({
        id: "spend",
        title: "Grant-attributed spend",
        body: `The team explicitly allocated $${totalSpendUsd.toLocaleString()} to this grant — ${parts.join("; ")}.`,
      });
    } else {
      sections.push({
        id: "spend",
        title: "No grant-linked expenses",
        body: "No finance transactions are allocated to this grant. Season-wide expenses are excluded.",
      });
    }
  } else {
    sections.push({
      id: "spend",
      title: "Grant-attributed spend unavailable",
      body: `${linkageNote} No season-wide expense is included as a substitute.`,
    });
  }

  return sections;
}

export function buildGrantReportNarrative(sections: GrantReportSection[]): string {
  return sections.map((section) => `${section.title}: ${section.body}`).join("\n\n");
}
