/**
 * Org-private edge over public EPA: scouting blend, component differentials,
 * opponent profiles, pick counter-sim, event-week twin, CAD/knowledge links.
 * Never invents DEMO metrics — skip any team/row without real public EPA + scout sample.
 */

export const PRIVATE_EPA_PUBLIC_WEIGHT = 0.6;
export const PRIVATE_EPA_SCOUT_WEIGHT = 0.4;
export const MIN_PEPA_SAMPLE = 3;
/** Typical FRC pack IR concern from real Battery Beak logs — not a DEMO threshold. */
export const HIGH_IR_MOHM = 20;

const CYCLE_TIME_KEYS = [
  "cycleTime",
  "cycle_time",
  "avgCycleTime",
  "secondsPerCycle",
  "cycleSeconds",
  "teleopCycleTime",
] as const;

const JAM_PAYLOAD_KEYS = ["jammed", "intakeJammed", "intake_jam", "jam", "disabled", "broken"] as const;
const JAM_NOTE_RE =
  /\b(jam(?:med|ming)?|intake\s*(?:stuck|fail|failing)|disabled|broke(?:n| down)?|didn't climb|no climb|climb fail)\b/i;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function firstFinite(payload: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (finite(value)) return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function payloadNotes(payload: Record<string, unknown>) {
  const notes: string[] = [];
  for (const key of ["notes", "note", "comments", "pitNotes", "observations", "summary"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length >= 3) notes.push(value.trim());
  }
  return notes;
}

export type ScoutComponentRates = {
  autoRate: number | null;
  teleopRate: number | null;
  endgameRate: number | null;
  sampleSize: number;
  cycleTimeSeconds?: number | null;
};

export type PrivateEpaResult = {
  skipped: false;
  teamKey: string;
  publicEpa: number;
  pepa: number;
  scoutComponentEpa: number;
  scoutSample: number;
  blend: { public: typeof PRIVATE_EPA_PUBLIC_WEIGHT; scout: typeof PRIVATE_EPA_SCOUT_WEIGHT };
  components: {
    autoRate: number | null;
    teleopRate: number | null;
    endgameRate: number | null;
    cycleTimeSeconds: number | null;
  };
};

export type PrivateEpaSkip = {
  skipped: true;
  teamKey: string;
  reason: string;
};

export function scoutedComponentEpa(input: {
  publicEpa: number;
  autoRate: number | null;
  teleopRate: number | null;
  endgameRate: number | null;
}): number | null {
  const parts: number[] = [];
  const push = (rate: number | null) => {
    if (rate == null || !Number.isFinite(rate)) return;
    parts.push(input.publicEpa * (0.25 + 0.75 * Math.min(1, Math.max(0, rate))));
  };
  push(input.autoRate);
  push(input.teleopRate);
  push(input.endgameRate);
  const averaged = mean(parts);
  return averaged == null ? null : round4(averaged);
}

export function blendPrivateEpa(input: {
  teamKey: string;
  publicEpa: number | null;
  scout: ScoutComponentRates;
}): PrivateEpaResult | PrivateEpaSkip {
  if (input.publicEpa == null || !Number.isFinite(input.publicEpa)) {
    return { skipped: true, teamKey: input.teamKey, reason: "No public season rating — our scouting number is not invented." };
  }
  if (input.scout.sampleSize < MIN_PEPA_SAMPLE) {
    return {
      skipped: true,
      teamKey: input.teamKey,
      reason: `Need ${MIN_PEPA_SAMPLE}+ org scout entries (have ${input.scout.sampleSize}).`,
    };
  }
  const component = scoutedComponentEpa({
    publicEpa: input.publicEpa,
    autoRate: input.scout.autoRate,
    teleopRate: input.scout.teleopRate,
    endgameRate: input.scout.endgameRate,
  });
  if (component == null) {
    return {
      skipped: true,
      teamKey: input.teamKey,
      reason: "Scout entries have no auto/teleop/endgame fields to blend.",
    };
  }
  const pepa = round4(
    PRIVATE_EPA_PUBLIC_WEIGHT * input.publicEpa + PRIVATE_EPA_SCOUT_WEIGHT * component,
  );
  return {
    skipped: false,
    teamKey: input.teamKey,
    publicEpa: round4(input.publicEpa),
    pepa,
    scoutComponentEpa: component,
    scoutSample: input.scout.sampleSize,
    blend: { public: PRIVATE_EPA_PUBLIC_WEIGHT, scout: PRIVATE_EPA_SCOUT_WEIGHT },
    components: {
      autoRate: input.scout.autoRate,
      teleopRate: input.scout.teleopRate,
      endgameRate: input.scout.endgameRate,
      cycleTimeSeconds: input.scout.cycleTimeSeconds ?? null,
    },
  };
}

export type ComponentDifferential = {
  field: "auto" | "teleop" | "climb" | "cycle_time";
  ourValue: number;
  theirValue: number;
  delta: number;
  unit: "rate" | "seconds";
  headline: string;
};

export function buildComponentDifferentials(input: {
  ourTeamKey: string;
  opponentTeamKey: string;
  our: ScoutComponentRates;
  opponent: ScoutComponentRates;
}): ComponentDifferential[] {
  if (input.our.sampleSize < MIN_PEPA_SAMPLE || input.opponent.sampleSize < MIN_PEPA_SAMPLE) {
    return [];
  }
  const rows: ComponentDifferential[] = [];
  const pushRate = (
    field: ComponentDifferential["field"],
    label: string,
    ours: number | null,
    theirs: number | null,
  ) => {
    if (ours == null || theirs == null) return;
    const delta = round4(theirs - ours);
    if (Math.abs(delta) < 0.02) return;
    rows.push({
      field,
      ourValue: round4(ours),
      theirValue: round4(theirs),
      delta,
      unit: "rate",
      headline:
        delta > 0
          ? `${input.opponentTeamKey.replace(/^frc/i, "")} ${label} ${Math.round(theirs * 100)}% vs yours ${Math.round(ours * 100)}%`
          : `Your ${label} ${Math.round(ours * 100)}% vs ${input.opponentTeamKey.replace(/^frc/i, "")} ${Math.round(theirs * 100)}%`,
    });
  };
  pushRate("auto", "auto reliability", input.our.autoRate, input.opponent.autoRate);
  pushRate("teleop", "teleop", input.our.teleopRate, input.opponent.teleopRate);
  pushRate("climb", "climb", input.our.endgameRate, input.opponent.endgameRate);
  const ourCycle = input.our.cycleTimeSeconds;
  const theirCycle = input.opponent.cycleTimeSeconds;
  if (ourCycle != null && theirCycle != null && ourCycle > 0 && theirCycle > 0) {
    const delta = round4(ourCycle - theirCycle);
    if (Math.abs(delta) >= 0.15) {
      rows.push({
        field: "cycle_time",
        ourValue: round4(ourCycle),
        theirValue: round4(theirCycle),
        delta,
        unit: "seconds",
        headline:
          delta > 0
            ? `${input.opponentTeamKey.replace(/^frc/i, "")} intake cycle ${delta.toFixed(1)}s faster (your scout data)`
            : `Your cycle ${Math.abs(delta).toFixed(1)}s faster than ${input.opponentTeamKey.replace(/^frc/i, "")}`,
      });
    }
  }
  return rows;
}

export type ScoutMatchObservation = {
  id?: string;
  teamKey: string;
  matchKey?: string | null;
  alliance?: "red" | "blue" | null;
  payload: Record<string, unknown>;
  updatedAt?: string | null;
  scoutUserId?: string | null;
  notes?: string[];
  mediaCount?: number;
};

export type OpponentProfile = {
  teamKey: string;
  sampleSize: number;
  climbRed: number | null;
  climbBlue: number | null;
  climbRedN: number;
  climbBlueN: number;
  cycleTimeP50: number | null;
  cycleDegradePct: number | null;
  cycleDegradeN: number;
  headlines: string[];
};

function climbFromPayload(payload: Record<string, unknown>) {
  const raw = firstFinite(payload, ["climb", "climbed", "climbSuccess", "endgame", "park"]);
  if (raw == null) return null;
  return raw > 1 ? Math.min(1, raw / 12) : Math.min(1, Math.max(0, raw));
}

export function extractCycleTimeSeconds(payload: Record<string, unknown>) {
  return firstFinite(payload, CYCLE_TIME_KEYS);
}

export function buildOpponentProfile(
  teamKey: string,
  observations: ScoutMatchObservation[],
): OpponentProfile | null {
  const rows = observations.filter((row) => row.teamKey === teamKey);
  if (rows.length < MIN_PEPA_SAMPLE) return null;

  const climbRed: number[] = [];
  const climbBlue: number[] = [];
  const cycles: Array<{ t: number; at: number }> = [];
  for (const row of rows) {
    const climb = climbFromPayload(row.payload);
    if (climb != null && row.alliance === "red") climbRed.push(climb);
    if (climb != null && row.alliance === "blue") climbBlue.push(climb);
    const cycle = extractCycleTimeSeconds(row.payload);
    const at = row.updatedAt ? Date.parse(row.updatedAt) : NaN;
    if (cycle != null && cycle > 0 && Number.isFinite(at)) cycles.push({ t: cycle, at });
  }

  const climbRedMean = mean(climbRed);
  const climbBlueMean = mean(climbBlue);
  const cycleTimeP50 = median(rows.map((row) => extractCycleTimeSeconds(row.payload)).filter(finite));

  let cycleDegradePct: number | null = null;
  const ordered = [...cycles].sort((a, b) => a.at - b.at);
  if (ordered.length >= 6) {
    const mid = Math.floor(ordered.length / 2);
    const first = mean(ordered.slice(0, mid).map((row) => row.t));
    const second = mean(ordered.slice(mid).map((row) => row.t));
    if (first != null && second != null && first > 0) {
      cycleDegradePct = round4((second - first) / first);
    }
  }

  const headlines: string[] = [];
  const n = teamKey.replace(/^frc/i, "");
  if (climbRedMean != null && climbBlueMean != null && climbRed.length >= 3 && climbBlue.length >= 3) {
    headlines.push(
      `Team ${n}: ${Math.round(climbRedMean * 100)}% climb on red, ${Math.round(climbBlueMean * 100)}% on blue (your data, n=${climbRed.length + climbBlue.length})`,
    );
  }
  if (cycleDegradePct != null && Math.abs(cycleDegradePct) >= 0.08) {
    headlines.push(
      `Team ${n}: cycle time ${cycleDegradePct > 0 ? "degrades" : "improves"} ${Math.round(Math.abs(cycleDegradePct) * 100)}% later in the event (your scout timestamps, n=${ordered.length})`,
    );
  }
  if (!headlines.length && cycleTimeP50 != null) {
    headlines.push(`Team ${n}: median scouted cycle ${cycleTimeP50.toFixed(1)}s (n=${rows.length})`);
  }
  if (!headlines.length) return null;

  return {
    teamKey,
    sampleSize: rows.length,
    climbRed: climbRedMean == null ? null : round4(climbRedMean),
    climbBlue: climbBlueMean == null ? null : round4(climbBlueMean),
    climbRedN: climbRed.length,
    climbBlueN: climbBlue.length,
    cycleTimeP50: cycleTimeP50 == null ? null : round4(cycleTimeP50),
    cycleDegradePct,
    cycleDegradeN: ordered.length,
    headlines,
  };
}

export type CounterPickSim = {
  skipped: boolean;
  reason: string;
  takenTeamKey: string;
  recommendedTeamKey: string | null;
  winRate: number | null;
  trials: number;
};

/**
 * Tiny Monte Carlo on org pEPA only. Skip unless enough private ratings exist.
 * Deterministic given the same seedless pool (uses a fixed LCG).
 */
export function simulateCounterPick(input: {
  takenTeamKey: string;
  ourTeamKey: string;
  pool: Array<{ teamKey: string; pepa: number; sampleSize: number }>;
  trials?: number;
}): CounterPickSim {
  const trials = input.trials ?? 200;
  const eligible = input.pool.filter(
    (row) =>
      row.sampleSize >= MIN_PEPA_SAMPLE &&
      Number.isFinite(row.pepa) &&
      row.teamKey !== input.takenTeamKey &&
      row.teamKey !== input.ourTeamKey,
  );
  const us = input.pool.find((row) => row.teamKey === input.ourTeamKey);
  const taken = input.pool.find((row) => row.teamKey === input.takenTeamKey);
  if (!us || eligible.length < 3 || !taken) {
    return {
      skipped: true,
      reason: "Counter-pick needs your scouting number plus 3+ other org-scouted teams.",
      takenTeamKey: input.takenTeamKey,
      recommendedTeamKey: null,
      winRate: null,
      trials: 0,
    };
  }

  let rng = 1_234_567;
  const next = () => {
    rng = (rng * 1_664_525 + 1_013_904_223) >>> 0;
    return rng / 0x1_0000_0000;
  };
  const noise = (pepa: number) => pepa + (next() - 0.5) * pepa * 0.12;

  let best: { teamKey: string; wins: number } | null = null;
  for (const candidate of eligible) {
    let wins = 0;
    for (let i = 0; i < trials; i += 1) {
      const ours = noise(us.pepa) + noise(candidate.pepa);
      const theirs = noise(taken.pepa) + noise(eligible[i % eligible.length]!.pepa);
      if (ours > theirs) wins += 1;
    }
    if (!best || wins > best.wins) best = { teamKey: candidate.teamKey, wins };
  }
  if (!best) {
    return {
      skipped: true,
      reason: "No partner candidate with a scouting number.",
      takenTeamKey: input.takenTeamKey,
      recommendedTeamKey: null,
      winRate: null,
      trials: 0,
    };
  }
  return {
    skipped: false,
    reason: `If 1st alliance takes ${input.takenTeamKey.replace(/^frc/i, "")}, our scouting numbers prefer ${best.teamKey.replace(/^frc/i, "")}.`,
    takenTeamKey: input.takenTeamKey,
    recommendedTeamKey: best.teamKey,
    winRate: round4(best.wins / trials),
    trials,
  };
}

export type DigitalTwinForecast = {
  skipped: boolean;
  headline: string;
  remainingMatches: number;
  highIrPacks: number;
  activePacks: number;
  cycleDegradePct: number | null;
};

export function forecastDigitalTwin(input: {
  remainingMatches: number;
  packs: Array<{ label: string; status: string; irMohm: number | null }>;
  ourCycleObservations: Array<{ cycleTimeSeconds: number; updatedAt: string }>;
}): DigitalTwinForecast {
  const active = input.packs.filter((pack) => pack.status === "active");
  const highIr = active.filter((pack) => pack.irMohm != null && pack.irMohm >= HIGH_IR_MOHM);
  const ordered = [...input.ourCycleObservations]
    .filter((row) => row.cycleTimeSeconds > 0)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  let cycleDegradePct: number | null = null;
  if (ordered.length >= 6) {
    const mid = Math.floor(ordered.length / 2);
    const first = mean(ordered.slice(0, mid).map((row) => row.cycleTimeSeconds));
    const second = mean(ordered.slice(mid).map((row) => row.cycleTimeSeconds));
    if (first != null && second != null && first > 0) {
      cycleDegradePct = round4((second - first) / first);
    }
  }
  if (!active.length && cycleDegradePct == null) {
    return {
      skipped: true,
      headline: "Digital twin needs battery logs or scouted cycle timestamps — nothing invented.",
      remainingMatches: input.remainingMatches,
      highIrPacks: 0,
      activePacks: 0,
      cycleDegradePct: null,
    };
  }
  const bits: string[] = [];
  if (highIr.length && input.remainingMatches > 0) {
    const labels = highIr.map((pack) => pack.label).filter(Boolean).slice(0, 4);
    const labelBit = labels.length ? ` (rotate ${labels.map((label) => `#${label}`).join(", ")} earlier)` : "";
    bits.push(
      `${highIr.length}/${active.length} active packs have IR ≥ ${HIGH_IR_MOHM} mΩ across ${input.remainingMatches} remaining match(es)${labelBit}.`,
    );
  } else if (active.length) {
    bits.push(`${active.length} active pack(s) logged; none at IR ≥ ${HIGH_IR_MOHM} mΩ.`);
  }
  if (cycleDegradePct != null && Math.abs(cycleDegradePct) >= 0.05) {
    bits.push(
      `Your scouted cycle time ${cycleDegradePct > 0 ? "slowed" : "improved"} ${Math.round(Math.abs(cycleDegradePct) * 100)}% later in this event (n=${ordered.length}).`,
    );
  }
  if (!bits.length) {
    return {
      skipped: true,
      headline: "Not enough battery IR or cycle-time trend to forecast event-week drop.",
      remainingMatches: input.remainingMatches,
      highIrPacks: highIr.length,
      activePacks: active.length,
      cycleDegradePct,
    };
  }
  return {
    skipped: false,
    headline: bits.join(" "),
    remainingMatches: input.remainingMatches,
    highIrPacks: highIr.length,
    activePacks: active.length,
    cycleDegradePct,
  };
}

export type PitSignalKind = "intake_jam" | "disabled" | "climb_fail" | "defense_contact" | "other";

export type PitSignal = {
  teamKey: string;
  matchKey: string | null;
  signalKind: PitSignalKind;
  note: string;
  alliance: "red" | "blue" | null;
  entryId?: string;
};

export function extractPitSignals(observations: Array<ScoutMatchObservation & { id?: string }>): PitSignal[] {
  const signals: PitSignal[] = [];
  for (const row of observations) {
    const notes = [...payloadNotes(row.payload), ...(row.notes ?? [])];
    let kind: PitSignalKind | null = null;
    for (const key of JAM_PAYLOAD_KEYS) {
      if (row.payload[key] === true) {
        kind = key === "disabled" || key === "broken" ? "disabled" : "intake_jam";
        break;
      }
    }
    const blob = notes.join(" ");
    if (!kind && JAM_NOTE_RE.test(blob)) {
      kind = /\bclimb\b/i.test(blob) ? "climb_fail" : /\bdisabl/i.test(blob) ? "disabled" : "intake_jam";
    }
    if (!kind && /\bdefen(?:se|ce)\s+(?:contact|hit|shove)/i.test(blob)) kind = "defense_contact";
    if (!kind) continue;
    signals.push({
      teamKey: row.teamKey,
      matchKey: row.matchKey ?? null,
      signalKind: kind,
      note: (notes[0] ?? kind.replace(/_/g, " ")).slice(0, 280),
      alliance: row.alliance ?? null,
      entryId: row.id,
    });
  }
  return signals;
}

export function clusterPitSignals(signals: PitSignal[], ourTeamKey: string) {
  const ours = signals.filter((signal) => signal.teamKey === ourTeamKey);
  if (ours.length < 2) return [] as string[];
  const byKind = new Map<PitSignalKind, PitSignal[]>();
  for (const signal of ours) {
    const list = byKind.get(signal.signalKind) ?? [];
    list.push(signal);
    byKind.set(signal.signalKind, list);
  }
  const lines: string[] = [];
  for (const [kind, list] of byKind) {
    if (list.length < 2) continue;
    const recent = list.slice(0, 8);
    const blue = recent.filter((row) => row.alliance === "blue").length;
    const red = recent.filter((row) => row.alliance === "red").length;
    const allianceBit =
      blue && !red ? "all on blue" : red && !blue ? "all on red" : `${red} red / ${blue} blue`;
    lines.push(`${recent.length} ${kind.replace(/_/g, " ")}(s) in last ${recent.length} flagged matches (${allianceBit}).`);
  }
  return lines;
}

export type CadScoutLink = {
  subsystemId: string;
  subsystemName: string;
  category: string;
  fieldKey: string;
  scoutSample: number;
  headline: string;
};

const CATEGORY_FIELDS: Record<string, string[]> = {
  intake: ["cycles", "teleopCycles", "cycleTime", "intake"],
  climber: ["climb", "endgame", "park"],
  shooter: ["teleop", "teleopPoints", "cycles"],
  indexer: ["cycles", "teleopCycles"],
  drivetrain: ["defense", "disabled"],
};

export function linkCadToScout(input: {
  subsystems: Array<{ id: string; name: string; category: string; notes?: string | null }>;
  fieldSamples: Array<{ fieldKey: string; sampleSize: number }>;
}): CadScoutLink[] {
  const sampleByField = new Map(input.fieldSamples.map((row) => [row.fieldKey, row.sampleSize]));
  const links: CadScoutLink[] = [];
  for (const subsystem of input.subsystems) {
    const keys = CATEGORY_FIELDS[subsystem.category] ?? [];
    for (const fieldKey of keys) {
      const sample = sampleByField.get(fieldKey) ?? 0;
      if (sample < MIN_PEPA_SAMPLE) continue;
      links.push({
        subsystemId: subsystem.id,
        subsystemName: subsystem.name,
        category: subsystem.category,
        fieldKey,
        scoutSample: sample,
        headline: `${subsystem.name} (${subsystem.category}) linked to scout field “${fieldKey}” (n=${sample}).`,
      });
    }
  }
  return links;
}

export type CrossSeasonNote = {
  kind: "decision" | "fmea" | "knowledge";
  title: string;
  detail: string;
};

export function crossSeasonVsOpponent(input: {
  opponentTeamNumber: number;
  decisions: Array<{ title: string; decision?: string | null; rationale?: string | null; category?: string | null }>;
  failures: Array<{ title: string; rootCause?: string | null; status?: string | null; subsystemName?: string | null }>;
  pages: Array<{ title: string; excerpt?: string | null }>;
}): CrossSeasonNote[] {
  const needle = new RegExp(`\\b${input.opponentTeamNumber}\\b`);
  const notes: CrossSeasonNote[] = [];
  for (const row of input.decisions) {
    const blob = `${row.title} ${row.decision ?? ""} ${row.rationale ?? ""}`;
    if (!needle.test(blob)) continue;
    notes.push({
      kind: "decision",
      title: row.title,
      detail: (row.rationale ?? row.decision ?? row.title).slice(0, 280),
    });
  }
  for (const row of input.failures) {
    const blob = `${row.title} ${row.rootCause ?? ""} ${row.subsystemName ?? ""}`;
    if (!needle.test(blob) && !/\bauto\b/i.test(blob)) continue;
    if (!needle.test(blob)) continue;
    notes.push({
      kind: "fmea",
      title: row.title,
      detail: (row.rootCause ?? row.title).slice(0, 280),
    });
  }
  for (const row of input.pages) {
    const blob = `${row.title} ${row.excerpt ?? ""}`;
    if (!needle.test(blob)) continue;
    notes.push({
      kind: "knowledge",
      title: row.title,
      detail: (row.excerpt ?? row.title).slice(0, 280),
    });
  }
  return notes.slice(0, 8);
}

export type ScoutCalibration = {
  scoutUserId: string;
  fieldKey: string;
  agreementRate: number;
  nSamples: number;
};

export type ScoutEvidenceCard = {
  teamKey: string;
  entryId: string;
  matchKey: string | null;
  note: string | null;
  source: string | null;
  mediaCount: number;
  updatedAt: string | null;
};

export type PrivateEdgeView = {
  status: "live" | "empty";
  message: string;
  eventKey: string;
  pepa: PrivateEpaResult[];
  skipped: PrivateEpaSkip[];
  differentials: ComponentDifferential[];
  calibrations: ScoutCalibration[];
  opponentProfiles: OpponentProfile[];
  counterPick: CounterPickSim | null;
  digitalTwin: DigitalTwinForecast;
  pitAlerts: string[];
  pitSignals: PitSignal[];
  cadLinks: CadScoutLink[];
  knowledge: CrossSeasonNote[];
  evidence: ScoutEvidenceCard[];
};

export function buildPrivateEdgeView(input: {
  eventKey: string;
  ourTeamKey: string;
  opponentTeamKeys: string[];
  pepa: Array<PrivateEpaResult | PrivateEpaSkip>;
  ourRates: ScoutComponentRates;
  opponentRates: Map<string, ScoutComponentRates>;
  observations: ScoutMatchObservation[];
  calibrations: ScoutCalibration[];
  counterPickTaken?: string | null;
  digitalTwin: DigitalTwinForecast;
  cadLinks: CadScoutLink[];
  knowledge: CrossSeasonNote[];
  evidence: ScoutEvidenceCard[];
}): PrivateEdgeView {
  const live = input.pepa.filter((row): row is PrivateEpaResult => !row.skipped);
  const skipped = input.pepa.filter((row): row is PrivateEpaSkip => row.skipped);
  const differentials = input.opponentTeamKeys.flatMap((opponent) => {
    const theirs = input.opponentRates.get(opponent);
    if (!theirs) return [];
    return buildComponentDifferentials({
      ourTeamKey: input.ourTeamKey,
      opponentTeamKey: opponent,
      our: input.ourRates,
      opponent: theirs,
    });
  });
  const opponentProfiles = input.opponentTeamKeys
    .map((teamKey) => buildOpponentProfile(teamKey, input.observations))
    .filter((row): row is OpponentProfile => row != null);
  const pitSignals = extractPitSignals(input.observations);
  const pitAlerts = clusterPitSignals(pitSignals, input.ourTeamKey);
  const pool = live.map((row) => ({ teamKey: row.teamKey, pepa: row.pepa, sampleSize: row.scoutSample }));
  const taken = input.counterPickTaken ?? input.opponentTeamKeys[0] ?? null;
  const counterPick = taken
    ? simulateCounterPick({ takenTeamKey: taken, ourTeamKey: input.ourTeamKey, pool })
    : null;

  const hasAnything =
    live.length > 0 ||
    differentials.length > 0 ||
    opponentProfiles.length > 0 ||
    pitAlerts.length > 0 ||
    input.cadLinks.length > 0 ||
    input.knowledge.length > 0 ||
    input.calibrations.length > 0 ||
    (!input.digitalTwin.skipped);

  return {
    status: hasAnything ? "live" : "empty",
    message: hasAnything
      ? "From your scouting + cached season ratings. Not shared."
      : "Needs org scout entries and cached season ratings. Nothing is invented.",
    eventKey: input.eventKey,
    pepa: live,
    skipped,
    differentials,
    calibrations: input.calibrations.filter((row) => row.nSamples >= MIN_PEPA_SAMPLE),
    opponentProfiles,
    counterPick,
    digitalTwin: input.digitalTwin,
    pitAlerts,
    pitSignals,
    cadLinks: input.cadLinks,
    knowledge: input.knowledge,
    evidence: input.evidence.slice(0, 12),
  };
}

export function cycleTimeFromObservations(observations: ScoutMatchObservation[]) {
  const values = observations.map((row) => extractCycleTimeSeconds(row.payload)).filter(finite);
  return median(values);
}
