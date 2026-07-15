import type { Metric, ScoutObservation } from "./types";

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function historicalTrajectory(metrics: Metric[]) {
  const byYear = new Map<number, number[]>();
  for (const metric of metrics) {
    if (metric.epaTotal === null) continue;
    byYear.set(metric.year, [...(byYear.get(metric.year) ?? []), metric.epaTotal]);
  }
  return [...byYear.entries()]
    .map(([year, values]) => ({
      year,
      epa: values.reduce((sum, value) => sum + value, 0) / values.length,
    }))
    .sort((a, b) => a.year - b.year);
}

export function robotArchetypes(metrics: Metric[], observations: ScoutObservation[]) {
  const latest = metrics.find((metric) => metric.epaTotal !== null);
  const labels = new Set<string>();
  if (latest?.epaAuto != null && latest.epaTotal && latest.epaAuto / latest.epaTotal > 0.28)
    labels.add("autonomous specialist");
  if (latest?.epaEndgame != null && latest.epaTotal && latest.epaEndgame / latest.epaTotal > 0.25)
    labels.add("endgame specialist");
  if (latest?.epaTeleop != null && latest.epaTotal && latest.epaTeleop / latest.epaTotal > 0.55)
    labels.add("teleop scorer");
  for (const observation of observations) {
    const text = JSON.stringify(observation.payload).toLowerCase();
    if (/\bdefen[cs]e\b/.test(text)) labels.add("defense-capable");
    if (/\bfeed(er|ing)?\b|\bsupport\b/.test(text)) labels.add("support robot");
  }
  return [...labels].slice(0, 4);
}

export function deriveReliability(observations: ScoutObservation[]) {
  const values = observations
    .map(({ payload }) =>
      ["totalPoints", "score", "cycles", "gamePieces"]
        .map((key) => payload[key])
        .find(finite),
    )
    .filter(finite);
  const failures = observations.filter(({ payload }) =>
    [payload.disabled, payload.breakdown, payload.noShow].some(Boolean),
  ).length;
  if (!observations.length)
    return { score: null, consistency: null, sampleSize: 0, evidence: "No scouting sample" };
  const mean = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  const deviation =
    mean !== null && values.length > 1
      ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
      : null;
  const consistency =
    mean && deviation !== null ? Math.max(0, Math.min(100, 100 - (deviation / Math.abs(mean)) * 100)) : null;
  const score = Math.max(0, Math.min(100, (1 - failures / observations.length) * 100));
  return {
    score,
    consistency,
    sampleSize: observations.length,
    evidence: `${failures} disabled, breakdown, or no-show flags in ${observations.length} observations`,
  };
}

export function deriveFoulRisk(observations: ScoutObservation[]) {
  const foulValues = observations
    .map(({ payload }) => [payload.fouls, payload.foulCount, payload.penalties].find(finite))
    .filter(finite);
  if (foulValues.length < 3)
    return {
      level: "unknown" as const,
      rate: null,
      sampleSize: foulValues.length,
      evidence: "At least 3 observations with foul counts are required",
    };
  const rate = foulValues.reduce((sum, value) => sum + value, 0) / foulValues.length;
  const level: "high" | "medium" | "low" =
    rate >= 1.5 ? "high" : rate >= 0.5 ? "medium" : "low";
  return {
    level,
    rate,
    sampleSize: foulValues.length,
    evidence: `Derived from ${foulValues.length} organization scouting observations`,
  };
}

export function headToHead(a: Metric | undefined, b: Metric | undefined) {
  const dimensions = ["epaTotal", "epaAuto", "epaTeleop", "epaEndgame"] as const;
  return dimensions.map((dimension) => {
    const av = a?.[dimension] ?? null;
    const bv = b?.[dimension] ?? null;
    return {
      dimension,
      a: av,
      b: bv,
      advantage: av === null || bv === null ? "unknown" : av === bv ? "even" : av > bv ? "a" : "b",
    };
  });
}

export function allianceChemistry(metrics: Metric[]) {
  const total = metrics.reduce((sum, metric) => sum + (metric.epaTotal ?? 0), 0);
  const auto = metrics.reduce((sum, metric) => sum + (metric.epaAuto ?? 0), 0);
  const endgame = metrics.reduce((sum, metric) => sum + (metric.epaEndgame ?? 0), 0);
  const known = metrics.filter((metric) => metric.epaTotal !== null).length;
  return {
    score: known ? Math.min(100, Math.max(0, 50 + total + auto * 0.3 + endgame * 0.2)) : null,
    totalEpa: known ? total : null,
    strengths: [
      auto > total * 0.25 ? "strong autonomous contribution" : null,
      endgame > total * 0.2 ? "strong endgame coverage" : null,
    ].filter((value): value is string => value !== null),
    caveat: "Metric fit only; role overlap and field compatibility require scouting review.",
  };
}

export function similarByEpa(
  target: { teamKey: string; epaTotal: number | null },
  candidates: Array<{ teamKey: string; teamNumber: number; nickname: string | null; epaTotal: number | null }>,
  limit = 5,
) {
  if (target.epaTotal === null) return [];
  return candidates
    .filter((candidate) => candidate.teamKey !== target.teamKey && candidate.epaTotal !== null)
    .sort(
      (a, b) =>
        Math.abs((a.epaTotal as number) - target.epaTotal!) -
        Math.abs((b.epaTotal as number) - target.epaTotal!),
    )
    .slice(0, limit);
}
