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

export type AllianceChemistryTeamInput = {
  teamKey: string;
  metric?: Metric | null;
  reliability?: number | null;
  foulRate?: number | null;
  scoutSample?: number;
  archetypes?: string[];
};

export type AllianceChemistryResult = {
  score: number | null;
  modelVersion: "alliance-chemistry-v1";
  totalEpa: number | null;
  complementarity: number | null;
  reliabilityBlend: number | null;
  foulRisk: "low" | "medium" | "high" | "unknown";
  strengths: string[];
  risks: string[];
  roles: Array<{ teamKey: string; primaryRole: string; evidence: string }>;
  caveats: string[];
  provenance: string[];
  /** @deprecated Prefer caveats[0] */
  caveat: string;
};

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * Alliance Chemistry compatibility scorer (alliance-chemistry-v1).
 * Scores role complementarity + EPA balance + scout reliability/foul risk.
 * Labeled MODEL — never a TBA alliance selection fact.
 */
export function scoreAllianceChemistry(teams: AllianceChemistryTeamInput[]): AllianceChemistryResult {
  const known = teams.filter((team) => team.metric?.epaTotal != null);
  const provenance: string[] = [
    "MODEL alliance-chemistry-v1 — not an official TBA alliance ranking.",
  ];
  if (!known.length) {
    const caveat =
      "Need event EPA metrics (TBA/Statbotics sync) before chemistry can score.";
    return {
      score: null,
      modelVersion: "alliance-chemistry-v1",
      totalEpa: null,
      complementarity: null,
      reliabilityBlend: null,
      foulRisk: "unknown",
      strengths: [],
      risks: ["Missing reference metrics for selected teams."],
      roles: [],
      caveats: [caveat],
      provenance,
      caveat,
    };
  }

  const total = known.reduce((sum, team) => sum + (team.metric!.epaTotal ?? 0), 0);
  const auto = known.reduce((sum, team) => sum + (team.metric!.epaAuto ?? 0), 0);
  const teleop = known.reduce((sum, team) => sum + (team.metric!.epaTeleop ?? 0), 0);
  const endgame = known.reduce((sum, team) => sum + (team.metric!.epaEndgame ?? 0), 0);
  provenance.push(
    `EPA totals from ${[...new Set(known.map((t) => t.metric!.source).filter(Boolean))].join("+") || "reference"} across ${known.length} teams.`,
  );

  const roles = teams.map((team) => {
    const m = team.metric;
    if (!m || m.epaTotal == null || m.epaTotal <= 0) {
      return {
        teamKey: team.teamKey,
        primaryRole: "unknown",
        evidence: "No event EPA for role assignment.",
      };
    }
    const shares = [
      { role: "auto specialist", value: (m.epaAuto ?? 0) / m.epaTotal },
      { role: "teleop scorer", value: (m.epaTeleop ?? 0) / m.epaTotal },
      { role: "endgame closer", value: (m.epaEndgame ?? 0) / m.epaTotal },
    ].sort((a, b) => b.value - a.value);
    const top = shares[0]!;
    const archetypeHint = team.archetypes?.[0];
    return {
      teamKey: team.teamKey,
      primaryRole: archetypeHint ?? top.role,
      evidence: `${team.teamKey}: ${top.role} share ${Math.round(top.value * 100)}% of EPA ${round1(m.epaTotal)} (${m.source}).`,
    };
  });

  const roleNames = roles.map((role) => role.primaryRole).filter((role) => role !== "unknown");
  const uniqueRoles = new Set(roleNames);
  const complementarity =
    roleNames.length >= 2
      ? Math.round((uniqueRoles.size / Math.min(3, roleNames.length)) * 100)
      : null;

  let score = 42 + Math.min(28, total * 0.55) + Math.min(10, auto * 0.35) + Math.min(8, endgame * 0.4);
  if (complementarity != null) {
    score += (complementarity - 50) * 0.18;
  }
  // Penalize triple-same role overlap
  if (roleNames.length >= 3 && uniqueRoles.size === 1) score -= 12;
  if (roleNames.length >= 3 && uniqueRoles.size === 2) score -= 4;

  const reliabilitySamples = teams.filter((team) => team.reliability != null && (team.scoutSample ?? 0) > 0);
  const reliabilityBlend = reliabilitySamples.length
    ? reliabilitySamples.reduce((sum, team) => sum + (team.reliability as number), 0) /
      reliabilitySamples.length
    : null;
  if (reliabilityBlend != null) {
    score += (reliabilityBlend - 70) * 0.12;
    provenance.push(
      `Scout reliability blend ${Math.round(reliabilityBlend)}% across ${reliabilitySamples.length} scouted robots.`,
    );
  }

  const foulRates = teams.map((team) => team.foulRate).filter((value): value is number => value != null);
  let foulRisk: AllianceChemistryResult["foulRisk"] = "unknown";
  if (foulRates.length) {
    const avg = foulRates.reduce((sum, value) => sum + value, 0) / foulRates.length;
    foulRisk = avg >= 1.5 ? "high" : avg >= 0.5 ? "medium" : "low";
    if (foulRisk === "high") score -= 8;
    else if (foulRisk === "medium") score -= 3;
    provenance.push(`Scout foul-rate average ~${round1(avg)} across ${foulRates.length} teams.`);
  }

  const strengths: string[] = [];
  const risks: string[] = [];
  if (auto > total * 0.25) strengths.push("Strong autonomous contribution across the alliance.");
  if (endgame > total * 0.2) strengths.push("Solid endgame coverage.");
  if (teleop > total * 0.5) strengths.push("Teleop scoring depth.");
  if (complementarity != null && complementarity >= 85) {
    strengths.push("Roles look complementary (auto / teleop / endgame not fully overlapping).");
  }
  if (complementarity != null && complementarity <= 45) {
    risks.push("High role overlap — alliance may leave a phase under-covered.");
  }
  if (reliabilityBlend != null && reliabilityBlend < 70) {
    risks.push(`Scout reliability blend is only ${Math.round(reliabilityBlend)}% — plan a reliability contingency.`);
  }
  if (foulRisk === "high") risks.push("Elevated foul exposure in scout notes.");
  if (known.length < teams.length) {
    risks.push(`${teams.length - known.length} alliance seat(s) missing EPA — score is partial.`);
  }

  const clamped = Math.round(Math.min(100, Math.max(0, score)));
  const caveat =
    "MODEL output for alliance fit — verify with pit scouting and field practice before locking picks.";
  return {
    score: clamped,
    modelVersion: "alliance-chemistry-v1",
    totalEpa: round1(total),
    complementarity,
    reliabilityBlend: reliabilityBlend != null ? Math.round(reliabilityBlend) : null,
    foulRisk,
    strengths,
    risks,
    roles,
    caveats: [caveat],
    provenance,
    caveat,
  };
}

/** Back-compat wrapper used by intel compare. */
export function allianceChemistry(metrics: Metric[]) {
  return scoreAllianceChemistry(
    metrics.map((metric, index) => ({
      teamKey: `team-${index + 1}`,
      metric,
    })),
  );
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
