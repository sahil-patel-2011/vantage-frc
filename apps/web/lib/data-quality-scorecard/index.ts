// Data Quality Scorecard: pure aggregation/scoring helpers. No I/O, no framework imports —
// unit-testable in isolation. Never fabricates a metric: an empty check log yields empty
// arrays and a null drift score rather than an invented number.

export * from "./types";
import type {
  DataQualityByEvent,
  DataQualityByScout,
  DataQualityCheck,
  DataQualityGrade,
  DataQualityScorecard,
  DataQualityScorecardSummary,
  DataQualityTrendPoint,
} from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** ISO week label (Mon-anchored) for trend bucketing, e.g. "2026-W07". */
export function isoWeekLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  const target = new Date(date.getTime());
  const dayNum = (date.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function summarizeDataQuality(checks: DataQualityCheck[]): DataQualityScorecardSummary {
  const totalChecks = checks.length;
  if (totalChecks === 0) {
    return {
      totalChecks: 0,
      coverage: 0,
      disagreementRate: 0,
      crossCheckedCount: 0,
      driftScore: null,
      byEvent: [],
      byScout: [],
      trend: [],
    };
  }

  const totalExpected = checks.reduce((sum, c) => sum + c.expectedDataPoints, 0);
  const totalCaptured = checks.reduce((sum, c) => sum + c.capturedDataPoints, 0);
  const coverage = totalExpected > 0 ? clamp01(totalCaptured / totalExpected) : 0;

  const crossChecked = checks.filter((c) => c.crossChecked && c.agreement !== null);
  const disagreements = crossChecked.filter((c) => c.agreement === false);
  const disagreementRate = crossChecked.length > 0 ? clamp01(disagreements.length / crossChecked.length) : 0;

  const byEventMap = new Map<string, DataQualityCheck[]>();
  const byScoutMap = new Map<string, DataQualityCheck[]>();
  for (const check of checks) {
    if (!byEventMap.has(check.eventKey)) byEventMap.set(check.eventKey, []);
    byEventMap.get(check.eventKey)!.push(check);
    if (!byScoutMap.has(check.scoutName)) byScoutMap.set(check.scoutName, []);
    byScoutMap.get(check.scoutName)!.push(check);
  }

  const byEvent: DataQualityByEvent[] = [...byEventMap.entries()]
    .map(([eventKey, rows]) => {
      const expected = rows.reduce((s, r) => s + r.expectedDataPoints, 0);
      const captured = rows.reduce((s, r) => s + r.capturedDataPoints, 0);
      const cc = rows.filter((r) => r.crossChecked && r.agreement !== null);
      const dis = cc.filter((r) => r.agreement === false);
      return {
        eventKey,
        checks: rows.length,
        coverage: expected > 0 ? round(clamp01(captured / expected)) : 0,
        disagreementRate: cc.length > 0 ? round(clamp01(dis.length / cc.length)) : 0,
        crossCheckedCount: cc.length,
      };
    })
    .sort((a, b) => b.checks - a.checks);

  const byScout: DataQualityByScout[] = [...byScoutMap.entries()]
    .map(([scoutName, rows]) => {
      const expected = rows.reduce((s, r) => s + r.expectedDataPoints, 0);
      const captured = rows.reduce((s, r) => s + r.capturedDataPoints, 0);
      const cc = rows.filter((r) => r.crossChecked && r.agreement !== null);
      const dis = cc.filter((r) => r.agreement === false);
      const deviations = rows.filter((r) => r.deviationScore !== null).map((r) => r.deviationScore as number);
      return {
        scoutName,
        checks: rows.length,
        coverage: expected > 0 ? round(clamp01(captured / expected)) : 0,
        disagreementRate: cc.length > 0 ? round(clamp01(dis.length / cc.length)) : 0,
        avgDeviation: deviations.length > 0 ? round(deviations.reduce((s, d) => s + d, 0) / deviations.length) : null,
      };
    })
    .sort((a, b) => b.checks - a.checks);

  const trendMap = new Map<string, DataQualityCheck[]>();
  for (const check of checks) {
    const week = isoWeekLabel(check.checkDate);
    if (!trendMap.has(week)) trendMap.set(week, []);
    trendMap.get(week)!.push(check);
  }
  const trend: DataQualityTrendPoint[] = [...trendMap.entries()]
    .map(([week, rows]) => {
      const expected = rows.reduce((s, r) => s + r.expectedDataPoints, 0);
      const captured = rows.reduce((s, r) => s + r.capturedDataPoints, 0);
      const deviations = rows.filter((r) => r.deviationScore !== null).map((r) => r.deviationScore as number);
      return {
        week,
        checks: rows.length,
        coverage: expected > 0 ? round(clamp01(captured / expected)) : 0,
        avgDeviation: deviations.length > 0 ? round(deviations.reduce((s, d) => s + d, 0) / deviations.length) : null,
      };
    })
    .sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));

  // Drift: how much average deviation has moved from the first half of the season's checks
  // (by week) to the second half. Positive = worsening calibration drift. Requires at least
  // two trend points with deviation data to be meaningful.
  const withDeviation = trend.filter((t) => t.avgDeviation !== null);
  let driftScore: number | null = null;
  if (withDeviation.length >= 2) {
    const mid = Math.floor(withDeviation.length / 2);
    const firstHalf = withDeviation.slice(0, mid || 1);
    const secondHalf = withDeviation.slice(mid || 1);
    const avg = (rows: DataQualityTrendPoint[]) =>
      rows.reduce((s, r) => s + (r.avgDeviation as number), 0) / rows.length;
    driftScore = round(avg(secondHalf) - avg(firstHalf));
  }

  return {
    totalChecks,
    coverage: round(coverage),
    disagreementRate: round(disagreementRate),
    crossCheckedCount: crossChecked.length,
    driftScore,
    byEvent,
    byScout,
    trend,
  };
}

function gradeFor(score: number): DataQualityGrade {
  if (score >= 0.8) return "excellent";
  if (score >= 0.6) return "solid";
  if (score >= 0.35) return "needs_attention";
  return "at_risk";
}

export function computeDataQualityScorecard(summary: DataQualityScorecardSummary): DataQualityScorecard {
  if (summary.totalChecks === 0) {
    return {
      score: 0,
      grade: "at_risk",
      components: { coverage: 0, agreement: 0, stability: 0 },
      recommendations: ["Log data-quality checks against scouting entries to build the scorecard."],
    };
  }

  const coverage = summary.coverage;
  const agreement = clamp01(1 - summary.disagreementRate);
  // Stability: unaffected (1.0) unless drift is measurable, then penalized by drift magnitude.
  const stability = summary.driftScore === null ? 1 : clamp01(1 - Math.min(1, Math.abs(summary.driftScore) * 2));

  const components = { coverage: round(coverage), agreement: round(agreement), stability: round(stability) };
  const score = round(0.45 * coverage + 0.35 * agreement + 0.2 * stability);

  const recommendations: string[] = [];
  if (components.coverage < 0.7) {
    recommendations.push(
      `Coverage is ${Math.round(components.coverage * 100)}% of expected data points — tighten scouting form completion.`,
    );
  }
  if (components.agreement < 0.7 && summary.crossCheckedCount > 0) {
    recommendations.push(
      `Cross-scout disagreement rate is ${Math.round(summary.disagreementRate * 100)}% — review scoring rubric alignment with the crew.`,
    );
  }
  if (summary.crossCheckedCount === 0) {
    recommendations.push("No cross-checks logged yet — pair scouts on a few matches to measure agreement.");
  }
  if (summary.driftScore !== null && summary.driftScore > 0.1) {
    recommendations.push("Deviation from consensus is trending up over the season — recalibrate scouts mid-event.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Data quality is holding steady — keep logging checks to confirm it through the season.");
  }

  return { score, grade: gradeFor(score), components, recommendations };
}
