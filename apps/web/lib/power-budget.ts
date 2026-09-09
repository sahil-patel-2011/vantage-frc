// Robot power / current budget. FRC robots run off one 12V battery through a 120A
// main breaker; each branch has its own breaker (40/30/20A). Drawing more than a
// branch breaker trips it; drawing too much total browns out the roboRIO and the
// robot resets mid-match. This sums the expected draw and flags both failure modes.

export const MAIN_BREAKER_AMPS = 120;
// A conservative sustained-draw ceiling: teams aim to keep the running average
// well under the main breaker to leave headroom for peaks and avoid brownouts.
export const SUSTAINED_DRAW_CEILING_AMPS = 100;

export type LoadInput = {
  name: string;
  subsystem: string;
  motorCount: number | null;
  typicalAmps: number | null;
  peakAmps: number | null;
  breakerAmps: number | null;
  notes: string;
};

function optNonNeg(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be zero or greater`);
  return parsed;
}
function optCount(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative whole number`);
  return parsed;
}

export function validateLoad(raw: Record<string, unknown>): { ok: true; value: LoadInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Load name is required" };
  let motorCount: number | null;
  let typicalAmps: number | null;
  let peakAmps: number | null;
  let breakerAmps: number | null;
  try {
    motorCount = optCount(raw.motorCount, "Motor count");
    typicalAmps = optNonNeg(raw.typicalAmps, "Typical current");
    peakAmps = optNonNeg(raw.peakAmps, "Peak current");
    breakerAmps = optNonNeg(raw.breakerAmps, "Breaker rating");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid number" };
  }
  return {
    ok: true,
    value: {
      name,
      subsystem: typeof raw.subsystem === "string" ? raw.subsystem.trim() : "",
      motorCount,
      typicalAmps,
      peakAmps,
      breakerAmps,
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    },
  };
}

export type PowerLoad = {
  name: string;
  subsystem?: string;
  typicalAmps: number | null;
  peakAmps: number | null;
  breakerAmps: number | null;
  motorCount?: number | null;
  notes?: string;
};

/**
 * CD 2026: 40A radios and 10A swerve modules showed up in the pit.
 * Only flags when the team logged a breaker rating — never invents a size.
 */
export function breakerSizeCues(loads: PowerLoad[]): string[] {
  const cues: string[] = [];
  for (const load of loads) {
    if (load.breakerAmps == null) continue;
    const hay = `${load.name} ${load.subsystem ?? ""}`.toLowerCase();
    if (/\bradio\b|vh-?109/.test(hay) && load.breakerAmps >= 20) {
      cues.push(
        `${load.name}: ${load.breakerAmps}A breaker on a radio — use the documented PD branch, not a 40A slot.`,
      );
    }
    if (/\bswerve\b|\bdrive(train)?\b/.test(hay) && load.breakerAmps > 0 && load.breakerAmps <= 10) {
      cues.push(
        `${load.name}: ${load.breakerAmps}A breaker on drivetrain/swerve — 10A modules nuisance-trip under load.`,
      );
    }
  }
  return cues;
}

/**
 * CD / R621: Mini Power Modules are custom circuits — they cannot break out multiple motors.
 * Cue only when the team logged an MPM-style load with motors.
 */
export function mpmMotorCues(loads: PowerLoad[]): string[] {
  const cues: string[] = [];
  for (const load of loads) {
    const hay = `${load.name} ${load.subsystem ?? ""} ${load.notes ?? ""}`.toLowerCase();
    if (!/\bmpm\b|mini power|mini[- ]pd/.test(hay)) continue;
    const motors = load.motorCount ?? 0;
    if (motors < 2 && !/\bmotor/.test(hay)) continue;
    cues.push(
      `${load.name}: Mini Power Module / custom circuit cannot feed multiple motors on one PD branch (R621).`,
    );
  }
  return cues;
}

export function currentLimitCue(brownoutRisk: boolean, loadCount: number): string | null {
  if (!brownoutRisk || loadCount === 0) return null;
  return "Set supply current limits on every motor before blaming static — brownouts were usually missing limits.";
}

export function staggerCue(brownoutRisk: boolean): string | null {
  if (!brownoutRisk) return null;
  return "Stagger high-current mechanisms and check swerve binding before blaming static.";
}

/**
 * Totals the draw and flags failure modes:
 *  - trip risk: a load whose peak current exceeds its own branch breaker.
 *  - brownout risk: total typical draw over the sustained-draw ceiling.
 *  - breaker size cues: radio/swerve sizes only from logged ratings.
 *  - MPM motor cues: Mini Power Module loads with motors only from logged rows.
 */
export function summarizePower(loads: PowerLoad[], sustainedCeiling = SUSTAINED_DRAW_CEILING_AMPS) {
  // `typical_amps` is nullable on purpose: "logged the load, have not measured
  // it yet" is a real state, and validateLoad accepts an empty value for it.
  // Summing it with `?? 0` erased that state — an entirely unmeasured robot
  // totalled 0 A, which is under any ceiling, so the page reported
  // "Brownout risk: no" against a robot nobody had measured. Partial data was
  // worse: five of fourteen loads measured presented a genuine undercount as
  // the robot's total draw and derived a safe verdict from it.
  //
  // The total now sums only measured loads, and the verdict is withheld while
  // any load is unmeasured. `null` means "cannot say yet" and is different
  // from `false`, which means "measured, and under the ceiling".
  const measured = loads.filter((l) => l.typicalAmps != null);
  const unmeasuredCount = loads.length - measured.length;
  const totalTypicalAmps = round1(measured.reduce((sum, l) => sum + (l.typicalAmps ?? 0), 0));
  const totalPeakAmps = round1(loads.reduce((sum, l) => sum + (l.peakAmps ?? 0), 0));
  const tripRisks = loads
    .filter((l) => l.peakAmps != null && l.breakerAmps != null && l.peakAmps > l.breakerAmps)
    .map((l) => l.name);

  // Over the ceiling on measured loads alone is a real finding even when the
  // picture is incomplete — more unmeasured draw can only make it worse. Under
  // the ceiling with loads still unmeasured says nothing.
  const overCeiling = totalTypicalAmps > sustainedCeiling;
  const brownoutRisk: boolean | null = overCeiling ? true : unmeasuredCount > 0 ? null : false;

  return {
    count: loads.length,
    measuredCount: measured.length,
    unmeasuredCount,
    totalTypicalAmps,
    totalPeakAmps,
    tripRisks,
    brownoutRisk,
    sustainedCeiling,
    breakerSizeCues: breakerSizeCues(loads),
    mpmMotorCues: mpmMotorCues(loads),
    currentLimitCue: currentLimitCue(brownoutRisk === true, loads.length),
    staggerCue: staggerCue(brownoutRisk === true),
  };
}

// ---- request validation --------------------------------------------------

export type PowerAction =
  | ({ action: "create_load"; orgId: string; seasonYear: number } & LoadInput)
  | { action: "update_load"; orgId: string; id: string; patch: LoadInput }
  | { action: "delete_load"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parsePowerAction(raw: unknown): PowerAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_load": {
      const validated = validateLoad(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action: "create_load", orgId, seasonYear, ...validated.value };
    }
    case "update_load": {
      const validated = validateLoad(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action: "update_load", orgId, id: reqStr(body.id, "id"), patch: validated.value };
    }
    case "delete_load":
      return { action: "delete_load", orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported power action");
  }
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
