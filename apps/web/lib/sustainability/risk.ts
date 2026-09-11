// Pure sustainability early-warning model. No I/O.
//
// Rules of the house, in order of importance:
//   1. REAL ROWS ONLY. Every factor cites the number it came from, in the string a mentor
//      reads. If a mentor can't trace "68%" back to a source they recorded, it doesn't ship.
//   2. THIN DATA => 'unknown', never a scary score. A team that has recorded nothing is not
//      a team at risk; it is a team we know nothing about, and saying otherwise is exactly
//      the fabrication this community dogpiles.
//   3. The thresholds trace to the Chief Delphi mortality analyses summarized in
//      docs/archive/COMMUNITY_DEMAND_RND.md: single-sponsor dependence (~50% of dead rookie teams had
//      exactly one sponsor vs a median of 3-4 for survivors) and the year-2-to-3 grant cliff.

import type {
  SustainabilityAssessment,
  SustainabilityFactor,
  SustainabilityLevel,
  SustainabilitySignals,
} from "./types";

/** Survivors carry a median of 3-4 funding sources; below this is the documented death track. */
export const HEALTHY_SOURCE_COUNT = 3;
/** One source above this share of funding is single-sponsor dependence in all but name. */
export const CRITICAL_CONCENTRATION_PCT = 60;
export const WARNING_CONCENTRATION_PCT = 40;
/** A season-over-season drop this steep is the grant cliff arriving. */
export const CRITICAL_FUNDING_DROP_PCT = 30;

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function fundedSources(signals: SustainabilitySignals) {
  return signals.fundingSources.filter((source) => source.receivedUsd > 0);
}

function businessHref(orgId: string | undefined, tab: string): string | undefined {
  if (!orgId) return undefined;
  return `/business?orgId=${encodeURIComponent(orgId)}&tab=${tab}`;
}

/**
 * Assess a team's funding sustainability from recorded rows.
 *
 * Returns `unknown` — with the list of what to record — whenever there is not enough real data
 * to say anything true. `orgId` is optional and only used to build deep links.
 */
export function assessSustainability(
  signals: SustainabilitySignals,
  orgId?: string,
): SustainabilityAssessment {
  const sources = fundedSources(signals);
  const totalReceivedUsd = sources.reduce((sum, source) => sum + source.receivedUsd, 0);
  const sorted = [...sources].sort((a, b) => b.receivedUsd - a.receivedUsd);
  const largest = sorted[0] ?? null;
  const largestSharePct =
    largest && totalReceivedUsd > 0
      ? Math.round((largest.receivedUsd / totalReceivedUsd) * 100)
      : null;

  const totals: SustainabilityAssessment["totals"] = {
    fundingSourceCount: sources.length,
    totalReceivedUsd,
    largestSourceName: largest?.name ?? null,
    largestSourceUsd: largest?.receivedUsd ?? null,
    largestSourceSharePct: largestSharePct,
  };

  // ---- Not enough data to be honest about ----------------------------------------------
  const missingInputs: string[] = [];
  if (sources.length === 0) {
    missingInputs.push(
      "Record this season's funding sources (school allocation, grants, sponsors, fundraisers) with the amount actually received.",
    );
  }
  if (totalReceivedUsd <= 0 && sources.length > 0) {
    missingInputs.push("Record the dollar amount received for at least one funding source.");
  }
  if (missingInputs.length > 0) {
    if (signals.studentCount == null) missingInputs.push("Add your student roster so we can watch headcount too.");
    if (signals.mentorCount == null) missingInputs.push("Add your mentors so we can flag a one-mentor team.");
    return { level: "unknown", factors: [], missingInputs, totals };
  }

  const factors: SustainabilityFactor[] = [];

  // ---- 1. Sponsor / source concentration -------------------------------------------------
  if (largest && largestSharePct !== null) {
    const prospects = signals.pipelineProspectCount;
    const prospectClause =
      prospects == null
        ? "Add prospects to the sponsor pipeline so there is a second source to fall back on."
        : prospects > 0
          ? `${prospects} prospect${prospects === 1 ? " is" : "s are"} in the pipeline — advance ${prospects === 1 ? "it" : "the top two"} this month.`
          : "No prospects are in the pipeline — add two before the season ends.";

    if (largestSharePct >= CRITICAL_CONCENTRATION_PCT) {
      factors.push({
        key: "sponsor_concentration",
        severity: "critical",
        headline: `${largest.name} is ${largestSharePct}% of your funding.`,
        evidence: `${money(largest.receivedUsd)} of ${money(totalReceivedUsd)} recorded across ${sources.length} source${sources.length === 1 ? "" : "s"}.`,
        nextAction: prospectClause,
        href: businessHref(orgId, "sponsors"),
      });
    } else if (largestSharePct >= WARNING_CONCENTRATION_PCT) {
      factors.push({
        key: "sponsor_concentration",
        severity: "warning",
        headline: `${largest.name} is ${largestSharePct}% of your funding.`,
        evidence: `${money(largest.receivedUsd)} of ${money(totalReceivedUsd)} recorded across ${sources.length} source${sources.length === 1 ? "" : "s"}.`,
        nextAction: prospectClause,
        href: businessHref(orgId, "sponsors"),
      });
    } else {
      factors.push({
        key: "sponsor_concentration",
        severity: "neutral",
        headline: `No single source exceeds ${largestSharePct}% of your funding.`,
        evidence: `Largest is ${largest.name} at ${money(largest.receivedUsd)} of ${money(totalReceivedUsd)}.`,
        nextAction: "Keep it spread — renew the top three before next season's kickoff.",
        href: businessHref(orgId, "sponsors"),
      });
    }
  }

  // ---- 2. Distinct funding source count --------------------------------------------------
  if (sources.length <= 1) {
    factors.push({
      key: "funding_source_count",
      severity: "critical",
      headline: `You have exactly ${sources.length} funding source on record.`,
      evidence:
        "Teams that died most often had a single sponsor; surviving teams carry a median of 3-4 sources (Chief Delphi team-mortality analysis).",
      nextAction: "Add a second source this season — a local business ask or a community-foundation grant.",
      href: businessHref(orgId, "sponsors"),
    });
  } else if (sources.length < HEALTHY_SOURCE_COUNT) {
    factors.push({
      key: "funding_source_count",
      severity: "warning",
      headline: `${sources.length} funding sources on record; surviving teams carry 3-4.`,
      evidence: `${sources.map((source) => source.name).join(", ")}.`,
      nextAction: `Add ${HEALTHY_SOURCE_COUNT - sources.length} more source${HEALTHY_SOURCE_COUNT - sources.length === 1 ? "" : "s"} before next kickoff.`,
      href: businessHref(orgId, "sponsors"),
    });
  } else {
    factors.push({
      key: "funding_source_count",
      severity: "neutral",
      headline: `${sources.length} distinct funding sources on record.`,
      evidence: `Total recorded ${money(totalReceivedUsd)}.`,
      nextAction: "Hold the line — log renewals as they land so this stays true.",
      href: businessHref(orgId, "finance"),
    });
  }

  // ---- 3. Expiring, unreplaced grants (the year-2-to-3 cliff) -----------------------------
  const unreplaced = signals.expiringGrants
    .filter((grant) => !grant.replaced)
    .sort((a, b) => a.daysUntilEnd - b.daysUntilEnd);
  const soonest = unreplaced[0];
  if (soonest) {
    const amountClause = soonest.amountUsd != null ? ` worth ${money(soonest.amountUsd)}` : "";
    const shareClause =
      soonest.amountUsd != null && totalReceivedUsd > 0
        ? ` — ${Math.round((soonest.amountUsd / totalReceivedUsd) * 100)}% of this season's recorded funding`
        : "";
    factors.push({
      key: "expiring_grant",
      severity: soonest.daysUntilEnd <= 60 ? "critical" : "warning",
      headline: `${soonest.name} ends in ${soonest.daysUntilEnd} day${soonest.daysUntilEnd === 1 ? "" : "s"} with nothing recorded to replace it.`,
      evidence: `Ends ${soonest.endsOn}${amountClause}${shareClause}. ${unreplaced.length - 1 > 0 ? `${unreplaced.length - 1} other unreplaced grant(s) also expiring.` : ""}`.trim(),
      nextAction: "Open the grant calendar and watch a replacement that closes before this one ends.",
      href: orgId
        ? `/team/grants/calendar?orgId=${encodeURIComponent(orgId)}`
        : "/team/grants/calendar",
    });
  }

  // ---- 4. Year-over-year funding delta ---------------------------------------------------
  if (signals.priorSeasonTotalUsd != null && signals.priorSeasonTotalUsd > 0) {
    const deltaPct = Math.round(
      ((totalReceivedUsd - signals.priorSeasonTotalUsd) / signals.priorSeasonTotalUsd) * 100,
    );
    if (deltaPct <= -CRITICAL_FUNDING_DROP_PCT) {
      factors.push({
        key: "funding_delta",
        severity: "critical",
        headline: `Recorded funding is down ${Math.abs(deltaPct)}% from last season.`,
        evidence: `${money(totalReceivedUsd)} this season vs ${money(signals.priorSeasonTotalUsd)} in ${signals.seasonYear - 1}.`,
        nextAction: "Confirm nothing is simply unlogged, then close the gap with two asks.",
        href: businessHref(orgId, "finance"),
      });
    } else if (deltaPct < 0) {
      factors.push({
        key: "funding_delta",
        severity: "warning",
        headline: `Recorded funding is down ${Math.abs(deltaPct)}% from last season.`,
        evidence: `${money(totalReceivedUsd)} this season vs ${money(signals.priorSeasonTotalUsd)} in ${signals.seasonYear - 1}.`,
        nextAction: "Check for unlogged income before treating this as a shortfall.",
        href: businessHref(orgId, "finance"),
      });
    }
  }

  // ---- 5. Roster / mentor depth (only when recorded) --------------------------------------
  if (signals.mentorCount != null && signals.mentorCount <= 1) {
    factors.push({
      key: "mentor_count",
      severity: "warning",
      headline: `${signals.mentorCount} mentor on the roster.`,
      evidence: "A one-mentor team ends when that mentor's kid graduates.",
      nextAction: "Recruit a second adult — a parent employer contact is the usual first yes.",
      href: orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team",
    });
  }
  if (signals.studentCount != null && signals.studentCount > 0 && signals.studentCount < 6) {
    factors.push({
      key: "roster_size",
      severity: "warning",
      headline: `${signals.studentCount} students on the roster.`,
      evidence: "Below the headcount most teams need to field a build and a drive crew.",
      nextAction: "Plan one recruiting demo before next season's sign-up window.",
      href: orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team",
    });
  }

  const level = rollUpLevel(factors);

  return {
    level,
    factors: factors.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    missingInputs: [],
    totals,
  };
}

function severityRank(severity: SustainabilityFactor["severity"]): number {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function rollUpLevel(factors: SustainabilityFactor[]): SustainabilityLevel {
  if (factors.some((factor) => factor.severity === "critical")) return "at-risk";
  if (factors.some((factor) => factor.severity === "warning")) return "watch";
  return "stable";
}

export function levelLabel(level: SustainabilityLevel): string {
  switch (level) {
    case "stable":
      return "Stable";
    case "watch":
      return "Watch";
    case "at-risk":
      return "At risk";
    case "unknown":
      return "Not enough recorded";
  }
}

/**
 * The two factors worth a mentor's next ten minutes. A stable team still gets the two
 * neutral readings back — the panel should say what it checked, not go blank.
 */
export function topFactors(
  assessment: SustainabilityAssessment,
  count = 2,
): SustainabilityFactor[] {
  const severe = assessment.factors.filter((factor) => factor.severity !== "neutral");
  return (severe.length > 0 ? severe : assessment.factors).slice(0, count);
}
