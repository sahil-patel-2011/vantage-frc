// Our-robot match debrief (self-scouting). After each of the team's own matches,
// log how the robot actually performed — result, points, what worked, what broke,
// and follow-up action items — so the team improves match to match. Distinct from
// scouting (which evaluates OTHER teams) and from match strategy planning.

export const MATCH_RESULTS = ["win", "loss", "tie", "unknown"] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];

export const ALLIANCES = ["red", "blue", "unknown"] as const;
export type Alliance = (typeof ALLIANCES)[number];

export type DebriefInput = {
  matchLabel: string;
  eventKey: string;
  alliance: Alliance;
  result: MatchResult;
  pointsScored: number | null;
  cycleCount: number | null;
  drivetrainOk: boolean;
  mechanismsOk: boolean;
  autoOk: boolean;
  whatWorked: string;
  whatBroke: string;
  actionItems: string;
};

function optInt(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative whole number`);
  return parsed;
}

export function validateDebrief(raw: Record<string, unknown>): { ok: true; value: DebriefInput } | { ok: false; error: string } {
  const matchLabel = typeof raw.matchLabel === "string" ? raw.matchLabel.trim() : "";
  if (!matchLabel) return { ok: false, error: "Match label is required (e.g. Qual 12)" };
  const result = String(raw.result ?? "unknown");
  if (!MATCH_RESULTS.includes(result as MatchResult)) return { ok: false, error: "Invalid result" };
  const alliance = String(raw.alliance ?? "unknown");
  if (!ALLIANCES.includes(alliance as Alliance)) return { ok: false, error: "Invalid alliance" };
  let pointsScored: number | null;
  let cycleCount: number | null;
  try {
    pointsScored = optInt(raw.pointsScored, "Points scored");
    cycleCount = optInt(raw.cycleCount, "Cycle count");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid number" };
  }
  return {
    ok: true,
    value: {
      matchLabel,
      eventKey: typeof raw.eventKey === "string" ? raw.eventKey.trim() : "",
      alliance: alliance as Alliance,
      result: result as MatchResult,
      pointsScored,
      cycleCount,
      drivetrainOk: raw.drivetrainOk !== false,
      mechanismsOk: raw.mechanismsOk !== false,
      autoOk: raw.autoOk !== false,
      whatWorked: typeof raw.whatWorked === "string" ? raw.whatWorked.trim() : "",
      whatBroke: typeof raw.whatBroke === "string" ? raw.whatBroke.trim() : "",
      actionItems: typeof raw.actionItems === "string" ? raw.actionItems.trim() : "",
    },
  };
}

export function summarizeDebriefs(debriefs: { result: MatchResult; pointsScored: number | null; actionItems: string }[]) {
  const wins = debriefs.filter((d) => d.result === "win").length;
  const losses = debriefs.filter((d) => d.result === "loss").length;
  const ties = debriefs.filter((d) => d.result === "tie").length;
  const scored = debriefs.filter((d) => d.pointsScored != null).map((d) => d.pointsScored as number);
  const avgPoints = scored.length ? Math.round((scored.reduce((sum, n) => sum + n, 0) / scored.length) * 10) / 10 : null;
  return {
    total: debriefs.length,
    wins,
    losses,
    ties,
    record: `${wins}-${losses}-${ties}`,
    avgPoints,
    openActionItems: debriefs.filter((d) => d.actionItems.trim().length > 0).length,
  };
}

// ---- request validation --------------------------------------------------

export type MatchDebriefAction =
  | ({ action: "create_debrief"; orgId: string; seasonYear: number } & DebriefInput)
  | { action: "update_debrief"; orgId: string; id: string; patch: DebriefInput }
  | { action: "delete_debrief"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseMatchDebriefAction(raw: unknown): MatchDebriefAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_debrief": {
      const validated = validateDebrief(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "update_debrief": {
      const validated = validateDebrief(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action, orgId, id: reqStr(body.id, "id"), patch: validated.value };
    }
    case "delete_debrief":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported match debrief action");
  }
}
