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

// ---- deterministic takeaways + optional AI coach --------------------------

export const MATCH_DEBRIEF_AI_FEATURE = "match_debrief";

export type DebriefForCoach = {
  matchLabel: string;
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

/**
 * Deterministic between-matches read of the log — computed only from what was
 * actually logged (honest empty state otherwise). This text always renders;
 * the AI coach below is an optional metered expansion of it.
 */
export function debriefTakeaways(debriefs: DebriefForCoach[]): string {
  if (debriefs.length === 0) {
    return "No matches logged yet — log a debrief after each match to see patterns worth fixing.";
  }
  const summary = summarizeDebriefs(debriefs);
  const lines: string[] = [];
  lines.push(
    `${summary.total} match${summary.total === 1 ? "" : "es"} logged (${summary.record}${
      summary.avgPoints != null ? `, avg ${summary.avgPoints} pts` : ""
    }).`,
  );

  const drivetrainIssues = debriefs.filter((d) => !d.drivetrainOk).length;
  const mechanismIssues = debriefs.filter((d) => !d.mechanismsOk).length;
  const autoIssues = debriefs.filter((d) => !d.autoOk).length;
  const systems = [
    drivetrainIssues ? `drivetrain in ${drivetrainIssues}` : "",
    mechanismIssues ? `mechanisms in ${mechanismIssues}` : "",
    autoIssues ? `auto in ${autoIssues}` : "",
  ].filter(Boolean);
  if (systems.length) {
    lines.push(`Recurring system issues — ${systems.join(", ")} of ${summary.total} matches.`);
  } else {
    lines.push("No robot-system issues flagged so far.");
  }

  const breakages = debriefs.filter((d) => d.whatBroke.trim());
  if (breakages.length) {
    const listed = breakages
      .slice(0, 3)
      .map((d) => `${d.matchLabel}: ${d.whatBroke.trim()}`)
      .join("; ");
    lines.push(`Logged breakages — ${listed}${breakages.length > 3 ? "; …" : ""}.`);
  }

  const open = debriefs.filter((d) => d.actionItems.trim());
  if (open.length) {
    lines.push(
      `${open.length} match${open.length === 1 ? " has" : "es have"} open action items — close them before the next match.`,
    );
  }
  return lines.join(" ");
}

/**
 * Grounded prompt for the optional AI coach. Returns null with no logged
 * matches — never asks a model to invent a performance history.
 */
export function buildDebriefCoachPrompt(input: {
  seasonYear: number;
  debriefs: DebriefForCoach[];
  takeaways: string;
}): string | null {
  if (input.debriefs.length === 0) return null;
  const rows = input.debriefs.slice(0, 20).map((d) =>
    JSON.stringify({
      match: d.matchLabel,
      result: d.result,
      points: d.pointsScored,
      cycles: d.cycleCount,
      drivetrainOk: d.drivetrainOk,
      mechanismsOk: d.mechanismsOk,
      autoOk: d.autoOk,
      worked: d.whatWorked,
      broke: d.whatBroke,
      actions: d.actionItems,
    }),
  );
  return [
    `You are a pit coach for an FRC team reviewing its own ${input.seasonYear} match debriefs (self-scouting of OUR robot, not other teams).`,
    "The logged debriefs below are the ONLY source of truth.",
    "",
    `Computed takeaways: ${input.takeaways}`,
    "",
    "Logged debriefs (most recent first):",
    ...rows,
    "",
    "Write one short paragraph: the single most important pattern to fix before the next match and the concrete first step, referencing only logged matches.",
    "Rules: use only the data above; do not invent matches, scores, or failures; if the log is thin, say what to start logging instead of speculating.",
  ].join("\n");
}
