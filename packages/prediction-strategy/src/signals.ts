import type { TeamOperationalSignal, TeamSeasonSignal } from "./types";

/** TBA / Statbotics-shaped event metric row used to build model inputs (fixtures or Neon cache). */
export type EventMetricRow = {
  teamKey: string;
  year: number;
  eventKey?: string;
  source?: string;
  epaTotal: number | null;
  epaAuto?: number | null;
  epaEndgame?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  rank?: number | null;
  /** Match count hint from payload or qual schedule; defaults applied when missing. */
  matches?: number | null;
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
    }
    if (!labels.length && !evidence.length) {
      evidence.push(`No event metrics or scout notes yet for ${teamKey}.`);
    }
    return { teamKey, labels, evidence };
  });
}

export type PickListHint = {
  teamKey: string;
  listName: string;
  rank: number;
  tier: string | null;
  notes: string | null;
};

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
