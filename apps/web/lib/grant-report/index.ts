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

/** Copy the report uses when nothing has been tagged — tested verbatim so it can never soften. */
export const NO_TAGGED_EXPENSES_NOTE =
  "No expenses tagged to this grant yet. Tag orders, season costs, or receipts to this grant in Finance to report fund usage — untagged season spend is never attributed to a grant.";

/** Sum of tagged spend lines; the spend state follows from whether any line exists. */
export function spendStateFor(spendByCategory: readonly GrantReportSpendLine[]): "no_tagged_expenses" | "tagged" {
  return spendByCategory.some((line) => line.count > 0) ? "tagged" : "no_tagged_expenses";
}

/**
 * Build the deterministic report sections + narrative from only what was recorded: the awarded
 * amount, logged outreach to the funder/sponsor, and the expenses a team TAGGED to this grant
 * (finance_transactions.grant_application_id, 0504). Skips any section that has no underlying
 * data rather than inventing figures; the spend section is always present so the absence of
 * tagged expenses is stated, never implied.
 */
export function buildGrantReportSections(input: {
  grantName: string;
  funder: string | null;
  seasonYear: number;
  amountAwardedUsd: number;
  outreachByKind: GrantReportOutreachLine[];
  /** Expenses tagged to THIS grant only. */
  spendByCategory: GrantReportSpendLine[];
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

  // Honesty guard: only expenses a team explicitly tagged to this grant are fund usage. The
  // spend section always exists so "nothing tagged" is stated outright, never implied.
  const taggedCount = input.spendByCategory.reduce((sum, line) => sum + line.count, 0);
  const totalSpendUsd = input.spendByCategory.reduce((sum, line) => sum + line.totalUsd, 0);
  if (taggedCount > 0) {
    const parts = input.spendByCategory
      .slice(0, 6)
      .map((line) => `${line.category}: $${line.totalUsd.toLocaleString()} (${line.count} txn)`);
    const coverage =
      input.amountAwardedUsd > 0
        ? ` That is ${Math.round((totalSpendUsd / input.amountAwardedUsd) * 100)}% of the $${input.amountAwardedUsd.toLocaleString()} award.`
        : "";
    sections.push({
      id: "spend",
      title: "Grant-attributed spending",
      body: `The team tagged ${taggedCount} expense(s) totaling $${totalSpendUsd.toLocaleString()} to this grant in the ${input.seasonYear} season, by category — ${parts.join("; ")}.${coverage}`,
    });
  } else {
    sections.push({
      id: "spend",
      title: "Grant-attributed spending",
      body: NO_TAGGED_EXPENSES_NOTE,
    });
  }

  return sections;
}

export function buildGrantReportNarrative(sections: GrantReportSection[]): string {
  return sections.map((section) => `${section.title}: ${section.body}`).join("\n\n");
}
