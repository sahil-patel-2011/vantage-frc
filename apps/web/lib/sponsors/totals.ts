/**
 * Team Sponsors money — per-sponsor amount and team total from recorded contribution rows.
 *
 * Postgres numerics arrive as strings. Invalid / missing values are $0, never NaN, and this
 * module never invents DEMO sponsors or placeholder raised totals.
 */

export type ContributionMoneyRow = {
  sponsorId?: string | null;
  type?: string | null;
  amountUsd?: string | number | null;
  estimatedValueUsd?: string | number | null;
};

export type SponsorLifetimeRow = {
  id: string;
  lifetimeContributionUsd?: string | number | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Postgres numeric / form string → finite dollars. Invalid → 0. */
export function parseContributionUsd(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? round2(n) : 0;
}

/**
 * One contribution row: cash uses `amountUsd`; in-kind / discount uses estimated value,
 * then amount as a fallback. Empty row → 0.
 */
export function contributionRowUsd(row: ContributionMoneyRow): number {
  const type = row.type ?? "cash";
  if (type === "cash") return parseContributionUsd(row.amountUsd);
  const estimated = parseContributionUsd(row.estimatedValueUsd);
  if (estimated !== 0) return estimated;
  return parseContributionUsd(row.amountUsd);
}

export function totalsBySponsorId(rows: readonly ContributionMoneyRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const id = typeof row.sponsorId === "string" ? row.sponsorId.trim() : "";
    if (!id) continue;
    totals[id] = round2((totals[id] ?? 0) + contributionRowUsd(row));
  }
  return totals;
}

export function teamContributionTotalUsd(rows: readonly ContributionMoneyRow[]): number {
  return round2(rows.reduce((sum, row) => sum + contributionRowUsd(row), 0));
}

export function teamLifetimeTotalUsd(sponsors: readonly SponsorLifetimeRow[]): number {
  return round2(sponsors.reduce((sum, sponsor) => sum + parseContributionUsd(sponsor.lifetimeContributionUsd), 0));
}

/**
 * Per-sponsor amounts + team total.
 *
 * When contribution rows have been loaded, those rows are the source of truth (zero rows → $0).
 * Before that load, fall back to API lifetime fields that are themselves summed from the same table.
 */
export function sponsorPageTotals(
  sponsors: readonly SponsorLifetimeRow[],
  contributionRows: readonly ContributionMoneyRow[],
  contributionsLoaded: boolean,
): { teamTotalUsd: number; amountBySponsorId: Record<string, number> } {
  if (contributionsLoaded) {
    const amountBySponsorId = { ...totalsBySponsorId(contributionRows) };
    for (const sponsor of sponsors) {
      if (amountBySponsorId[sponsor.id] == null) amountBySponsorId[sponsor.id] = 0;
    }
    return { teamTotalUsd: teamContributionTotalUsd(contributionRows), amountBySponsorId };
  }
  const amountBySponsorId: Record<string, number> = {};
  for (const sponsor of sponsors) {
    amountBySponsorId[sponsor.id] = parseContributionUsd(sponsor.lifetimeContributionUsd);
  }
  return { teamTotalUsd: teamLifetimeTotalUsd(sponsors), amountBySponsorId };
}

export function formatSponsorUsd(value: number): string {
  const n = parseContributionUsd(value);
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
