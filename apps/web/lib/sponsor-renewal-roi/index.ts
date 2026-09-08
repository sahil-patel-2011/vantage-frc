// Pure, unit-testable helpers for sponsor renewal-risk scoring. No I/O.
// Weighted churn-risk model over real, logged cross-feature signals only:
//   - sponsor_interactions (0035) recency + trailing-12mo frequency
//   - sponsor_contributions (0035) recency
//   - impact_activities (0038) mentions of the sponsor by name, trailing 12mo
//   - outreach_evidence_vault_items (0348) attached to those mentioned activities
// Showcase page views are folded in "where tracked" — no view-tracking table exists in the
// schema yet, so that component always stays null (never fabricated) until one does.

export * from "./types";
import type {
  SponsorRenewalRiskComponents,
  SponsorRenewalRiskInputs,
  SponsorRenewalRiskScore,
  SponsorRenewalRiskTier,
  SponsorRenewalRoiSection,
} from "./types";

const MS_PER_DAY = 86_400_000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function daysSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MS_PER_DAY));
}

/** Weight of each component in the overall risk average. Components with no underlying data
 *  are excluded and the remaining weights renormalized — never defaulted to a fabricated value. */
const COMPONENT_WEIGHTS: Record<keyof Omit<SponsorRenewalRiskComponents, "showcaseViews">, number> = {
  interactionRecency: 0.3,
  interactionFrequency: 0.2,
  contributionRecency: 0.25,
  impactMentions: 0.15,
  evidenceCoverage: 0.1,
};

export function riskTierFromScore(score: number): SponsorRenewalRiskTier {
  if (score < 0.34) return "low";
  if (score < 0.67) return "moderate";
  return "high";
}

export function computeSponsorRenewalRiskScore(inputs: SponsorRenewalRiskInputs): SponsorRenewalRiskScore {
  const daysSinceLastInteraction = inputs.lastInteractionAt ? daysSince(inputs.lastInteractionAt, inputs.now) : null;
  const daysSinceLastContribution = inputs.lastContributionAt ? daysSince(inputs.lastContributionAt, inputs.now) : null;

  const components: SponsorRenewalRiskComponents = {
    // No interaction has ever been logged — recency/frequency are undefined, not "max risk".
    interactionRecency: daysSinceLastInteraction === null ? null : clamp01(daysSinceLastInteraction / 180),
    interactionFrequency: daysSinceLastInteraction === null ? null : clamp01(1 - inputs.interactionCount12mo / 6),
    contributionRecency: daysSinceLastContribution === null ? null : clamp01(daysSinceLastContribution / 365),
    // A count of zero mentions is itself a real, logged signal (not fabricated) — always computed.
    impactMentions: clamp01(1 - inputs.impactMentionCount12mo / 3),
    // Undefined when no mentions exist to attach evidence to, and also when the
    // deployment tracks no evidence at all (evidenceItemCount === null).
    evidenceCoverage:
      inputs.impactMentionCount12mo > 0 && inputs.evidenceItemCount !== null
        ? clamp01(1 - inputs.evidenceItemCount / inputs.impactMentionCount12mo)
        : null,
    showcaseViews: null,
  };

  const noLinkedActivity =
    inputs.lastInteractionAt === null &&
    inputs.lastContributionAt === null &&
    inputs.impactMentionCount12mo === 0 &&
    (inputs.evidenceItemCount ?? 0) === 0;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of Object.keys(COMPONENT_WEIGHTS) as Array<keyof typeof COMPONENT_WEIGHTS>) {
    const value = components[key];
    if (value === null) continue;
    const weight = COMPONENT_WEIGHTS[key];
    weightedSum += value * weight;
    totalWeight += weight;
  }

  const score = totalWeight > 0 ? clamp01(weightedSum / totalWeight) : 1;

  return {
    sponsorId: inputs.sponsorId,
    sponsorName: inputs.sponsorName,
    score,
    tier: riskTierFromScore(score),
    components,
    noLinkedActivity,
    daysSinceLastInteraction,
    daysSinceLastContribution,
  };
}

/** Deterministic ROI report sections assembled from the same cross-feature data as the score —
 *  no invented figures, and any zero counts are surfaced plainly rather than smoothed over. */
export function buildSponsorRoiSections(input: {
  sponsorName: string;
  seasonYear: number;
  risk: SponsorRenewalRiskScore;
  totalContributionUsd: number;
  contributionCount: number;
  interactionCount12mo: number;
  impactMentionCount12mo: number;
  /** `null` when this deployment has nowhere to attach outreach evidence. */
  evidenceItemCount: number | null;
}): SponsorRenewalRoiSection[] {
  const { risk } = input;
  const sections: SponsorRenewalRoiSection[] = [];

  sections.push({
    heading: "Partnership snapshot",
    body:
      input.contributionCount > 0
        ? `${input.sponsorName} has contributed $${input.totalContributionUsd.toLocaleString()} across ${input.contributionCount} recorded contribution(s) for the ${input.seasonYear} season.`
        : `No recorded contributions from ${input.sponsorName} are on file for the ${input.seasonYear} season yet.`,
  });

  sections.push({
    heading: "Engagement activity",
    body: `${input.interactionCount12mo} logged interaction(s) in the trailing 12 months${
      risk.daysSinceLastInteraction !== null ? `, most recently ${risk.daysSinceLastInteraction} day(s) ago` : ""
    }.`,
  });

  sections.push({
    heading: "Community visibility",
    body:
      input.impactMentionCount12mo > 0
        ? `${input.sponsorName} was named in ${input.impactMentionCount12mo} logged community-impact activity/activities in the trailing 12 months${
            input.evidenceItemCount === null
              ? ""
              : `, with ${input.evidenceItemCount} evidence item(s) attached`
          }.`
        : `No logged community-impact activity has named ${input.sponsorName} in the trailing 12 months — consider crediting them in the next outreach log entry.`,
  });

  sections.push({
    heading: "Renewal-risk assessment",
    body: risk.noLinkedActivity
      ? `No linked activity (interactions, contributions, or impact mentions) is on file for ${input.sponsorName} — a risk score cannot be computed until some is logged.`
      : `Renewal-risk score: ${Math.round(risk.score * 100)}% (${risk.tier} risk), based on ${
          Object.values(risk.components).filter((v) => v !== null).length
        } of ${Object.keys(risk.components).length} available signals.`,
  });

  return sections;
}

export function renderSponsorRoiHtml(input: {
  sponsorName: string;
  seasonYear: number;
  sections: SponsorRenewalRoiSection[];
}): string {
  const body = input.sections
    .map((section) => `<section><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p></section>`)
    .join("\n");
  return `<article class="sponsor-roi-report"><header><h1>${escapeHtml(
    input.sponsorName,
  )} — ${input.seasonYear} Partnership ROI Report</h1></header>\n${body}\n</article>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
