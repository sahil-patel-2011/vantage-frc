// Impact-award evidence readiness, computed from the logged activity record itself.
// This never fabricates a score: an empty log yields 0 across the board. It scores the
// dimensions FRC judges actually weigh for Impact / Engineering Inspiration — total
// volume, people reached, sustained cadence, breadth of audiences, and youth (K-12) focus
// — and turns the weakest dimensions into concrete next steps.

import { DEFAULT_TARGETS, type ImpactTargets } from "./activities";
import type { ImpactReadiness, ImpactSummary, ImpactTier } from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export type ImpactReadinessTargets = ImpactTargets & {
  /** Distinct audience types that reads as broad community reach (default 4). */
  audienceTarget: number;
};

const DEFAULT_READINESS_TARGETS: ImpactReadinessTargets = {
  ...DEFAULT_TARGETS,
  audienceTarget: 4,
};

function tierFor(score: number): ImpactTier {
  if (score >= 0.66) return "strong";
  if (score >= 0.33) return "developing";
  return "emerging";
}

export function computeImpactReadiness(
  summary: ImpactSummary,
  targets: Partial<ImpactReadinessTargets> = {},
): ImpactReadiness {
  const t = { ...DEFAULT_READINESS_TARGETS, ...targets };

  const volume = clamp01(summary.totalHours / t.hoursTarget);
  const reach = clamp01(summary.totalPeopleReached / t.peopleTarget);
  const monthsActive = summary.byMonth.length;
  const cadence = clamp01(monthsActive / t.sustainedMonths);
  const audiencesReached = summary.byAudience.filter((row) => row.audience !== "internal").length;
  const audienceBreadth = clamp01(audiencesReached / t.audienceTarget);

  const k12 = summary.byAudience.find((row) => row.audience === "k12");
  const youthFocus = summary.totalEvents > 0 ? clamp01((k12?.events ?? 0) / summary.totalEvents) : 0;

  const components = {
    volume: round(volume),
    reach: round(reach),
    cadence: round(cadence),
    audienceBreadth: round(audienceBreadth),
    youthFocus: round(youthFocus),
  };

  const score = round(
    0.3 * volume + 0.25 * reach + 0.2 * cadence + 0.15 * audienceBreadth + 0.1 * youthFocus,
  );

  return {
    score,
    tier: tierFor(score),
    components,
    monthsActive,
    audiencesReached,
    recommendations: buildRecommendations(summary, components, monthsActive, audiencesReached, t),
  };
}

function buildRecommendations(
  summary: ImpactSummary,
  components: ImpactReadiness["components"],
  monthsActive: number,
  audiencesReached: number,
  t: ImpactReadinessTargets,
): string[] {
  if (summary.totalEvents === 0) {
    return ["Log your first community-impact activity — STEM demos, mentoring, and community events all count."];
  }
  const out: string[] = [];
  if (components.cadence < 0.5) {
    out.push(
      `Spread activity across more of the season — active in ${monthsActive} of ${t.sustainedMonths} target months. Sustained impact is judged higher than one-off events.`,
    );
  }
  if (components.reach < 0.5) {
    out.push(
      `Grow reach toward ${t.peopleTarget.toLocaleString()} people — ${summary.totalPeopleReached.toLocaleString()} logged so far.`,
    );
  }
  if (components.volume < 0.5) {
    out.push(`Log more hours toward ${t.hoursTarget}h — ${summary.totalHours}h recorded.`);
  }
  if (components.audienceBreadth < 0.5) {
    out.push(
      `Broaden audiences — ${audiencesReached} of ${t.audienceTarget} distinct groups reached. Impact judges look for varied community engagement.`,
    );
  }
  if (components.youthFocus < 0.25) {
    out.push("Add K-12 STEM outreach — inspiring young students is central to the Impact narrative.");
  }
  if (out.length === 0) {
    out.push("Strong, well-rounded record — keep it current and capture photos/quotes for the submission.");
  }
  return out;
}
