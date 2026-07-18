import type { TeamOperationalSignal, TeamSeasonSignal } from "./types";

/** TBA / Statbotics-shaped event metric row used to build model inputs (fixtures or Neon cache). */
export type EventMetricRow = {
  teamKey: string;
  year: number;
  eventKey?: string;
  source?: string;
  epaTotal: number | null;
  epaAuto?: number | null;
  epaTeleop?: number | null;
  epaEndgame?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  rank?: number | null;
  /** Match count hint from payload or qual schedule; defaults applied when missing. */
  matches?: number | null;
  syncedAt?: string | null;
};

/** Season-long Statbotics (or TBA) year EPA rows from Neon `team_year_metrics`. */
export type YearMetricRow = {
  teamKey: string;
  year: number;
  source?: string;
  epaTotal: number | null;
  epaAuto?: number | null;
  epaTeleop?: number | null;
  epaEndgame?: number | null;
  /** Sample size hint; defaults to a modest season weight when absent. */
  matches?: number | null;
  syncedAt?: string | null;
};

export type AllianceTeamBrief = {
  teamKey: string;
  epa: number | null;
  autoEpa: number | null;
  endgameEpa: number | null;
  source: string | null;
  record: string | null;
  rank: number | null;
  scoutSample: number;
  reliability: number | null;
  foulRate: number | null;
  qualityWeight: number | null;
  autoCapability: number | null;
  teleopCapability: number | null;
  endgameCapability: number | null;
  defenseLikely: boolean;
  pitNotes: string[];
  scoutEntryIds: string[];
  videoRescoutCount: number;
};

export type AllianceMatchup = {
  red: AllianceTeamBrief[];
  blue: AllianceTeamBrief[];
  redTotalEpa: number | null;
  blueTotalEpa: number | null;
  considerations: string[];
};

export type OpponentTendency = {
  teamKey: string;
  labels: string[];
  evidence: string[];
  /** Scout entry ids that influenced labels/evidence for this opponent. */
  scoutEntryIds?: string[];
};

/**
 * Map TBA/Statbotics-shaped metrics into season signals for `predictMatch`.
 * Skips rows without EPA — never invents demo defaults.
 */
export function signalsFromEventMetrics(rows: EventMetricRow[]): TeamSeasonSignal[] {
  const signals: TeamSeasonSignal[] = [];
  for (const row of rows) {
    if (row.epaTotal == null || !Number.isFinite(row.epaTotal)) continue;
    const played =
      (row.wins ?? 0) + (row.losses ?? 0) + (row.ties ?? 0) ||
      (row.matches != null && row.matches > 0 ? row.matches : 0);
    signals.push({
      teamKey: row.teamKey,
      year: row.year,
      matches: played > 0 ? played : 6,
      epa: row.epaTotal,
      autoEpa: row.epaAuto ?? undefined,
      endgameEpa: row.epaEndgame ?? undefined,
      source: row.source,
      eventKey: row.eventKey,
    });
  }
  return signals;
}

/**
 * Map season-long year EPA into signals. Skips null EPA — never fabricates values.
 */
export function signalsFromYearMetrics(rows: YearMetricRow[]): TeamSeasonSignal[] {
  const signals: TeamSeasonSignal[] = [];
  for (const row of rows) {
    if (row.epaTotal == null || !Number.isFinite(row.epaTotal)) continue;
    const matches =
      row.matches != null && row.matches > 0 ? row.matches : 18;
    signals.push({
      teamKey: row.teamKey,
      year: row.year,
      matches,
      epa: row.epaTotal,
      autoEpa: row.epaAuto ?? undefined,
      endgameEpa: row.epaEndgame ?? undefined,
      source: row.source,
    });
  }
  return signals;
}

function sourceRank(source?: string) {
  if (source === "statbotics") return 0;
  if (source === "tba") return 1;
  return 2;
}

/**
 * Fuse event + year metrics for weighted-current prediction.
 * Prefer event-level EPA over year-level for the same team+year; prefer Statbotics over TBA.
 * Never invents missing EPA rows.
 */
export function fuseSeasonSignals(input: {
  eventMetrics: EventMetricRow[];
  yearMetrics?: YearMetricRow[];
}): TeamSeasonSignal[] {
  const byTeamYear = new Map<string, TeamSeasonSignal>();
  const consider = (signal: TeamSeasonSignal, preferEvent: boolean) => {
    const key = `${signal.teamKey}:${signal.year}`;
    const existing = byTeamYear.get(key);
    if (!existing) {
      byTeamYear.set(key, signal);
      return;
    }
    const existingIsEvent = Boolean(existing.eventKey);
    const nextIsEvent = Boolean(signal.eventKey);
    if (preferEvent && nextIsEvent && !existingIsEvent) {
      byTeamYear.set(key, signal);
      return;
    }
    if (preferEvent && existingIsEvent && !nextIsEvent) return;
    if (sourceRank(signal.source) < sourceRank(existing.source)) {
      byTeamYear.set(key, signal);
    }
  };
  for (const signal of signalsFromEventMetrics(input.eventMetrics)) {
    consider(signal, true);
  }
  for (const signal of signalsFromYearMetrics(input.yearMetrics ?? [])) {
    consider(signal, true);
  }
  return [...byTeamYear.values()].sort(
    (a, b) => b.year - a.year || a.teamKey.localeCompare(b.teamKey),
  );
}

export function allianceTeamBrief(
  teamKey: string,
  metrics: EventMetricRow[],
  operations: TeamOperationalSignal[] = [],
): AllianceTeamBrief {
  const metric = metrics.find((row) => row.teamKey === teamKey);
  const op = operations.find((row) => row.teamKey === teamKey);
  const wins = metric?.wins ?? null;
  const losses = metric?.losses ?? null;
  const ties = metric?.ties ?? null;
  const hasRecord = wins != null || losses != null || ties != null;
  return {
    teamKey,
    epa: metric?.epaTotal ?? null,
    autoEpa: metric?.epaAuto ?? null,
    endgameEpa: metric?.epaEndgame ?? null,
    source: metric?.source ?? null,
    record: hasRecord ? `${wins ?? 0}-${losses ?? 0}-${ties ?? 0}` : null,
    rank: metric?.rank ?? null,
    scoutSample: op?.scoutSample ?? 0,
    reliability: op?.reliability ?? null,
    foulRate: op?.foulRate ?? null,
    qualityWeight: op?.qualityWeight ?? null,
    autoCapability: op?.autoCapability ?? null,
    teleopCapability: op?.teleopCapability ?? null,
    endgameCapability: op?.endgameCapability ?? null,
    defenseLikely: Boolean(op?.defenseLikely),
    pitNotes: op?.pitNotes ?? [],
    scoutEntryIds: op?.scoutEntryIds ?? [],
    videoRescoutCount: op?.videoRescoutCount ?? 0,
  };
}

export function buildAllianceMatchup(input: {
  red: string[];
  blue: string[];
  metrics: EventMetricRow[];
  operations?: TeamOperationalSignal[];
}): AllianceMatchup {
  const operations = input.operations ?? [];
  const red = input.red.map((teamKey) => allianceTeamBrief(teamKey, input.metrics, operations));
  const blue = input.blue.map((teamKey) => allianceTeamBrief(teamKey, input.metrics, operations));
  const sumEpa = (teams: AllianceTeamBrief[]) => {
    const known = teams.filter((team) => team.epa != null);
    if (!known.length) return null;
    return known.reduce((total, team) => total + (team.epa as number), 0);
  };
  const redTotalEpa = sumEpa(red);
  const blueTotalEpa = sumEpa(blue);
  const considerations: string[] = [];
  if (redTotalEpa != null && blueTotalEpa != null) {
    const margin = redTotalEpa - blueTotalEpa;
    considerations.push(
      `Alliance EPA totals (event metrics): red ${round1(redTotalEpa)} vs blue ${round1(blueTotalEpa)} (margin ${round1(margin)}).`,
    );
  }
  const autoGap =
    sumKnown(red.map((t) => t.autoEpa)) - sumKnown(blue.map((t) => t.autoEpa));
  if (Math.abs(autoGap) >= 2) {
    considerations.push(
      `Autonomous EPA edge favors ${autoGap > 0 ? "red" : "blue"} by ${round1(Math.abs(autoGap))}.`,
    );
  }
  const scouted = [...red, ...blue].filter((team) => team.scoutSample > 0);
  if (scouted.length) {
    considerations.push(
      `Org scouting covers ${scouted.length}/${red.length + blue.length} alliance robots (${scouted.map((t) => t.teamKey).join(", ")}).`,
    );
  } else {
    considerations.push("No org scout sample on this matchup yet — model uses reference EPA only.");
  }
  const foulHeavy = [...red, ...blue].filter((team) => (team.foulRate ?? 0) >= 1);
  if (foulHeavy.length) {
    considerations.push(
      `Elevated foul rate in scout notes: ${foulHeavy.map((t) => `${t.teamKey} (~${round1(t.foulRate!)}/match)`).join(", ")}.`,
    );
  }
  const autoCapable = [...red, ...blue].filter((team) => (team.autoCapability ?? 0) >= 0.45);
  if (autoCapable.length) {
    considerations.push(
      `Scout auto capability strong for ${autoCapable
        .map((t) => `${t.teamKey} (~${Math.round((t.autoCapability ?? 0) * 100)}%)`)
        .join(", ")}.`,
    );
  }
  const teleopCapable = [...red, ...blue].filter((team) => (team.teleopCapability ?? 0) >= 0.45);
  if (teleopCapable.length) {
    considerations.push(
      `Scout teleop/cycles noted for ${teleopCapable
        .map((t) => `${t.teamKey} (~${Math.round((t.teleopCapability ?? 0) * 100)}%)`)
        .join(", ")}.`,
    );
  }
  const defense = [...red, ...blue].filter((team) => team.defenseLikely);
  if (defense.length) {
    considerations.push(
      `Defense noted in scout payloads: ${defense.map((t) => t.teamKey).join(", ")}.`,
    );
  }
  const pitNoted = [...red, ...blue].filter((team) => team.pitNotes.length > 0);
  if (pitNoted.length) {
    considerations.push(
      `Pit/match notes on ${pitNoted.map((t) => t.teamKey).join(", ")}: ${pitNoted
        .flatMap((t) => t.pitNotes.slice(0, 1).map((note) => `${t.teamKey} “${note.slice(0, 80)}”`))
        .join("; ")}.`,
    );
  }
  const qualityWarned = [...red, ...blue].filter(
    (team) => team.qualityWeight != null && team.qualityWeight < 0.85 && team.scoutSample > 0,
  );
  if (qualityWarned.length) {
    considerations.push(
      `Scout quality downweights applied: ${qualityWarned
        .map((t) => `${t.teamKey} (mean ${Math.round((t.qualityWeight ?? 1) * 100)}%)`)
        .join(", ")}.`,
    );
  }
  const videoRescored = [...red, ...blue].filter((team) => team.videoRescoutCount > 0);
  if (videoRescored.length) {
    considerations.push(
      `Video-rescored scout entries: ${videoRescored
        .map((t) => `${t.teamKey} (${t.videoRescoutCount})`)
        .join(", ")}.`,
    );
  }
  const withIds = [...red, ...blue].flatMap((team) => team.scoutEntryIds).slice(0, 12);
  if (withIds.length) {
    considerations.push(
      `Scout provenance entry ids: ${withIds.map((id) => id.slice(0, 8)).join(", ")}${
        withIds.length >= 12 ? "…" : ""
      }.`,
    );
  }
  return { red, blue, redTotalEpa, blueTotalEpa, considerations };
}

export function opponentTendencies(input: {
  opponentKeys: string[];
  metrics: EventMetricRow[];
  operations?: TeamOperationalSignal[];
}): OpponentTendency[] {
  const operations = input.operations ?? [];
  return input.opponentKeys.map((teamKey) => {
    const metric = input.metrics.find((row) => row.teamKey === teamKey);
    const op = operations.find((row) => row.teamKey === teamKey);
    const labels: string[] = [];
    const evidence: string[] = [];
    if (metric?.epaTotal != null && metric.epaAuto != null && metric.epaTotal > 0) {
      if (metric.epaAuto / metric.epaTotal > 0.28) {
        labels.push("autonomous-leaning");
        evidence.push(
          `${teamKey} auto EPA ${round1(metric.epaAuto)} is ${Math.round((metric.epaAuto / metric.epaTotal) * 100)}% of event EPA (${metric.source ?? "reference"}).`,
        );
      }
    }
    if (metric?.epaTotal != null && metric.epaEndgame != null && metric.epaTotal > 0) {
      if (metric.epaEndgame / metric.epaTotal > 0.25) {
        labels.push("endgame-leaning");
        evidence.push(
          `${teamKey} endgame EPA ${round1(metric.epaEndgame)} from ${metric.source ?? "reference"} metrics.`,
        );
      }
    }
    if (metric?.wins != null && metric.losses != null) {
      evidence.push(
        `${teamKey} event record ${metric.wins}-${metric.losses}-${metric.ties ?? 0}${metric.rank != null ? ` · rank ${metric.rank}` : ""}.`,
      );
    }
    const scoutEntryIds = op?.scoutEntryIds ?? [];
    if (op && op.scoutSample > 0) {
      if (op.reliability != null && op.reliability < 70) {
        labels.push("reliability-risk");
        evidence.push(`Scout reliability ${Math.round(op.reliability)}% across ${op.scoutSample} observations.`);
      } else if (op.reliability != null) {
        evidence.push(`Scout reliability ${Math.round(op.reliability)}% (n=${op.scoutSample}).`);
      }
      if ((op.foulRate ?? 0) >= 1.5) {
        labels.push("foul-prone");
        evidence.push(`Scout foul rate ~${round1(op.foulRate!)} per match.`);
      } else if ((op.foulRate ?? 0) >= 0.5) {
        labels.push("contact-aware");
        evidence.push(`Moderate scout foul rate ~${round1(op.foulRate!)} per match.`);
      }
      if ((op.autoCapability ?? 0) >= 0.45) {
        labels.push("scout-auto-capable");
        evidence.push(
          `Scout auto capability ~${Math.round((op.autoCapability ?? 0) * 100)}% (entries ${scoutEntryIds
            .slice(0, 3)
            .map((id) => id.slice(0, 8))
            .join(", ") || "n/a"}).`,
        );
      }
      if ((op.teleopCapability ?? 0) >= 0.45) {
        labels.push("scout-teleop-capable");
        evidence.push(`Scout teleop capability ~${Math.round((op.teleopCapability ?? 0) * 100)}%.`);
      }
      if ((op.endgameCapability ?? 0) >= 0.45) {
        labels.push("scout-endgame-capable");
        evidence.push(`Scout endgame capability ~${Math.round((op.endgameCapability ?? 0) * 100)}%.`);
      }
      if (op.defenseLikely) {
        labels.push("defense-capable");
        evidence.push("Defense mentioned in org scout payloads.");
      }
      if (op.pitNotes?.length) {
        labels.push("pit-noted");
        evidence.push(`Pit/match notes: ${op.pitNotes.slice(0, 2).join(" · ")}`);
      }
      if (op.qualityWeight != null && op.qualityWeight < 0.85) {
        labels.push("scout-quality-adjusted");
        evidence.push(
          `Scout quality mean weight ${Math.round(op.qualityWeight * 100)}%${
            op.qualityNotes?.[0] ? ` — ${op.qualityNotes[0]}` : ""
          }.`,
        );
      }
      if ((op.videoRescoutCount ?? 0) > 0) {
        labels.push("video-rescored");
        evidence.push(
          `${op.videoRescoutCount} video-rescored ${op.videoRescoutCount === 1 ? "entry" : "entries"} committed from match footage${
            op.videoReviewIds?.length ? ` (review ${op.videoReviewIds[0]!.slice(0, 8)})` : ""
          }.`,
        );
      }
      if (scoutEntryIds.length) {
        evidence.push(
          `Influenced by scout entries: ${scoutEntryIds
            .slice(0, 6)
            .map((id) => id.slice(0, 8))
            .join(", ")}.`,
        );
      }
    }
    if (!labels.length && !evidence.length) {
      evidence.push(`No event metrics or scout notes yet for ${teamKey}.`);
    }
    return { teamKey, labels, evidence, scoutEntryIds: scoutEntryIds.length ? scoutEntryIds : undefined };
  });
}

export type PickListHint = {
  teamKey: string;
  listName: string;
  rank: number;
  tier: string | null;
  notes: string | null;
};

export type PickTier = "first" | "second" | "third" | "watch";

/** full = scout reliability can demote tiers; low_data_tba = TBA/Statbotics EPA-first quick pick. */
export type PickDataMode = "full" | "low_data_tba";

export type PickCandidate = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  epa: number | null;
  autoEpa: number | null;
  endgameEpa: number | null;
  source: string | null;
  record: string | null;
  rank: number | null;
  scoutSample: number;
  reliability: number | null;
  foulRate: number | null;
  suggestedTier: PickTier | null;
};

export type PickDataModeInfo = {
  mode: PickDataMode;
  scoutedTeams: number;
  teamCount: number;
  /** Human-readable reason when mode is low_data_tba; null in full mode. */
  reason: string | null;
};

const TIER_ORDER: Record<PickTier, number> = {
  first: 0,
  second: 1,
  third: 2,
  watch: 3,
};

/**
 * Under-resourced desks (Chief Delphi "quick pick") when most event teams lack scout depth.
 * Threshold: fewer than 25% of teams have >=2 scout observations.
 */
export function detectPickDataMode(
  candidates: Array<{ scoutSample: number }>,
  options?: { minCoverage?: number; minSample?: number },
): PickDataModeInfo {
  const minCoverage = options?.minCoverage ?? 0.25;
  const minSample = options?.minSample ?? 2;
  const teamCount = candidates.length;
  const scoutedTeams = candidates.filter((row) => row.scoutSample >= minSample).length;
  if (teamCount === 0) {
    return {
      mode: "low_data_tba",
      scoutedTeams: 0,
      teamCount: 0,
      reason: "No event teams loaded — waiting on TBA/Statbotics sync.",
    };
  }
  const coverage = scoutedTeams / teamCount;
  if (coverage < minCoverage) {
    return {
      mode: "low_data_tba",
      scoutedTeams,
      teamCount,
      reason: `Only ${scoutedTeams}/${teamCount} teams have >=${minSample} scout entries — ranking from TBA/Statbotics EPA.`,
    };
  }
  return { mode: "full", scoutedTeams, teamCount, reason: null };
}

/**
 * Rank event teams for pick-list desks using only real EPA/rank/scout signals.
 * Suggested tiers are relative percentiles of known EPA at the event — teams without
 * EPA stay unsorted with suggestedTier null (never invent metrics).
 *
 * `mode: "low_data_tba"` skips scout-reliability demotion so thin-scout events still
 * get a usable TBA/Statbotics-driven quick pick order.
 */
export function rankPickCandidates(
  candidates: Array<Omit<PickCandidate, "suggestedTier">>,
  options?: { mode?: PickDataMode },
): PickCandidate[] {
  const mode = options?.mode ?? "full";
  const withEpa = candidates
    .map((candidate) => candidate.epa)
    .filter((epa): epa is number => epa != null && Number.isFinite(epa))
    .sort((a, b) => b - a);
  const percentileTier = (epa: number): PickTier => {
    if (!withEpa.length) return "watch";
    const better = withEpa.filter((value) => value > epa).length;
    const pct = better / withEpa.length;
    if (pct <= 0.2) return "first";
    if (pct <= 0.45) return "second";
    if (pct <= 0.7) return "third";
    return "watch";
  };
  const scored = candidates.map((candidate) => {
    const hasEpa = candidate.epa != null && Number.isFinite(candidate.epa);
    let suggestedTier: PickTier | null = null;
    if (hasEpa) {
      suggestedTier = percentileTier(candidate.epa as number);
      if (
        mode === "full" &&
        (candidate.reliability ?? 100) < 65 &&
        suggestedTier === "first"
      ) {
        suggestedTier = "second";
      }
    }
    return { ...candidate, suggestedTier };
  });
  return scored.sort((a, b) => {
    if (mode === "low_data_tba") {
      const epaA = a.epa ?? -Infinity;
      const epaB = b.epa ?? -Infinity;
      if (epaA !== epaB) return epaB - epaA;
      const rankA = a.rank ?? 9999;
      const rankB = b.rank ?? 9999;
      if (rankA !== rankB) return rankA - rankB;
      const tierA = a.suggestedTier ? TIER_ORDER[a.suggestedTier] : 99;
      const tierB = b.suggestedTier ? TIER_ORDER[b.suggestedTier] : 99;
      if (tierA !== tierB) return tierA - tierB;
      return a.teamKey.localeCompare(b.teamKey);
    }
    const tierA = a.suggestedTier ? TIER_ORDER[a.suggestedTier] : 99;
    const tierB = b.suggestedTier ? TIER_ORDER[b.suggestedTier] : 99;
    if (tierA !== tierB) return tierA - tierB;
    const epaA = a.epa ?? -Infinity;
    const epaB = b.epa ?? -Infinity;
    if (epaA !== epaB) return epaB - epaA;
    const rankA = a.rank ?? 9999;
    const rankB = b.rank ?? 9999;
    if (rankA !== rankB) return rankA - rankB;
    return a.teamKey.localeCompare(b.teamKey);
  });
}

export function pickListHintsForAlliance(
  allianceKeys: string[],
  entries: Array<{ teamKey: string; listName: string; rank: number; tier?: string | null; notes?: string | null }>,
): PickListHint[] {
  const wanted = new Set(allianceKeys);
  return entries
    .filter((entry) => wanted.has(entry.teamKey))
    .map((entry) => ({
      teamKey: entry.teamKey,
      listName: entry.listName,
      rank: entry.rank,
      tier: entry.tier ?? null,
      notes: entry.notes ?? null,
    }))
    .sort((a, b) => a.rank - b.rank || a.teamKey.localeCompare(b.teamKey));
}

function sumKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  return known.reduce((sum, value) => sum + value, 0);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
