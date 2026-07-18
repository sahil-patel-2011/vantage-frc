// Pure, framework-free Sponsor Suite math and text synthesis. Everything here is deterministic and
// grounded only in the rows the caller supplies (sponsors / sponsor_contributions) — it never
// fabricates a sponsor, dollar amount, or contribution that isn't in the data.
// compute-sponsor-suite.ts wraps this with DB I/O + meteredAI; the API route and client render results.

import type {
  SponsorSuiteDeckKind,
  SponsorSuiteDeckSection,
  SponsorSuiteGoalProgress,
  SponsorSuiteRoiLine,
} from "./types";

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function tierLabel(tier: string): string {
  switch (tier) {
    case "in_kind":
      return "In-kind";
    case "bronze":
      return "Bronze";
    case "silver":
      return "Silver";
    case "gold":
      return "Gold";
    case "platinum":
      return "Platinum";
    default:
      return "Custom";
  }
}

export function reminderKindLabel(kind: string): string {
  return kind === "thank_you" ? "Thank-you" : "Renewal";
}

/** Goal-vs-actual attainment. Returns null attainment/remaining when no goal is set. */
export function computeGoalProgress(seasonYear: number, goalUsd: number | null, actualUsd: number): SponsorSuiteGoalProgress {
  const actual = round(Math.max(0, actualUsd));
  if (goalUsd == null || goalUsd <= 0) {
    return { seasonYear, goalUsd: null, actualUsd: actual, attainmentPct: null, remainingUsd: null };
  }
  const goal = round(goalUsd);
  return {
    seasonYear,
    goalUsd: goal,
    actualUsd: actual,
    attainmentPct: round(actual / goal, 4),
    remainingUsd: round(Math.max(0, goal - actual)),
  };
}

/** Aggregate raw contributions into per-sponsor ROI lines, largest contributor first. */
export function summarizeRoiLines(
  rows: Array<{ sponsorId: string; sponsorName: string; tier: string; amountUsd: number }>,
): SponsorSuiteRoiLine[] {
  const bySponsor = new Map<string, SponsorSuiteRoiLine>();
  for (const row of rows) {
    const existing = bySponsor.get(row.sponsorId);
    if (existing) {
      existing.totalContributedUsd = round(existing.totalContributedUsd + row.amountUsd);
      existing.contributionCount += 1;
    } else {
      bySponsor.set(row.sponsorId, {
        sponsorId: row.sponsorId,
        sponsorName: row.sponsorName,
        tier: row.tier,
        totalContributedUsd: round(row.amountUsd),
        contributionCount: 1,
      });
    }
  }
  return Array.from(bySponsor.values()).sort((a, b) => b.totalContributedUsd - a.totalContributedUsd);
}

/** Deterministic end-of-season ROI narrative — grounded only in the supplied lines/goal. */
export function buildRoiNarrative(input: {
  seasonYear: number;
  lines: SponsorSuiteRoiLine[];
  totalRaisedUsd: number;
  goalUsd: number | null;
  attainmentPct: number | null;
}): string {
  const { seasonYear, lines, totalRaisedUsd, goalUsd, attainmentPct } = input;
  if (lines.length === 0) {
    return `No recorded sponsor contributions for ${seasonYear} yet — log contributions to generate an ROI report.`;
  }
  const top = lines.slice(0, 3).map((l) => `${l.sponsorName} ($${l.totalContributedUsd.toLocaleString()})`);
  const goalLine =
    goalUsd != null && attainmentPct != null
      ? ` Raised ${Math.round(attainmentPct * 100)}% of the $${goalUsd.toLocaleString()} season goal.`
      : "";
  return (
    `${seasonYear} season: $${totalRaisedUsd.toLocaleString()} raised from ${lines.length} sponsor(s), ` +
    `${lines.reduce((sum, l) => sum + l.contributionCount, 0)} contribution(s).${goalLine} ` +
    `Top contributors: ${top.join(", ")}.`
  );
}

/** Deterministic pitch/renewal deck outline — grounded only in the sponsor's own recorded history. */
export function buildDeckSections(input: {
  kind: SponsorSuiteDeckKind;
  sponsorName: string | null;
  teamNumber: number | null;
  seasonYear: number;
  priorContributionsUsd: number;
  priorContributionCount: number;
  goal: SponsorSuiteGoalProgress;
}): SponsorSuiteDeckSection[] {
  const { kind, sponsorName, teamNumber, seasonYear, priorContributionsUsd, priorContributionCount, goal } = input;
  const teamLabel = teamNumber != null ? `Team ${teamNumber}` : "our FRC team";
  const sections: SponsorSuiteDeckSection[] = [
    {
      heading: "Who we are",
      body: `${teamLabel} is competing in the ${seasonYear} FIRST Robotics Competition season. This deck outlines the ${
        kind === "renewal" ? "renewal ask" : "sponsorship opportunity"
      }${sponsorName ? ` for ${sponsorName}` : ""}.`,
    },
  ];
  if (kind === "renewal") {
    sections.push({
      heading: "Prior support",
      body:
        priorContributionCount > 0
          ? `${sponsorName ?? "This sponsor"} has contributed $${priorContributionsUsd.toLocaleString()} across ${priorContributionCount} contribution(s) on record. Thank you for the partnership.`
          : `No prior recorded contributions were found for ${sponsorName ?? "this sponsor"} — confirm history before sending a renewal ask.`,
    });
  }
  sections.push({
    heading: "Season goal",
    body:
      goal.goalUsd != null
        ? `The team's ${seasonYear} fundraising goal is $${goal.goalUsd.toLocaleString()}; $${goal.actualUsd.toLocaleString()} raised so far (${
            goal.attainmentPct != null ? `${Math.round(goal.attainmentPct * 100)}%` : "0%"
          }).`
        : `No season fundraising goal is set yet — set one to include progress-to-goal in this deck.`,
  });
  sections.push({
    heading: "The ask",
    body:
      kind === "renewal"
        ? "We're asking you to renew your support at the same or a higher tier for this season."
        : "We're asking you to become a sponsor — cash, in-kind, or discount contributions all help.",
  });
  return sections;
}
