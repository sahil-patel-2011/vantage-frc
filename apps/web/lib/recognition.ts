// Internal team recognition: end-of-season member awards that the team nominates
// and votes on (MVP, Most Improved, Rookie of the Year, Best Mentor…). Distinct
// from /team/awards, which tracks FIRST *competition* awards the team applies for.
// A simple three-stage cycle: nominating -> voting -> closed.

export const RECOGNITION_STAGES = ["nominating", "voting", "closed"] as const;
export type RecognitionStage = (typeof RECOGNITION_STAGES)[number];

export const RECOGNITION_STAGE_LABEL: Record<RecognitionStage, string> = {
  nominating: "Nominating",
  voting: "Voting",
  closed: "Closed",
};

/** Common team-award categories offered as quick-adds in the create form. */
export const SUGGESTED_AWARDS = [
  "Most Valuable Player",
  "Most Improved",
  "Rookie of the Year",
  "Best Mentor",
  "Unsung Hero",
  "Safety Star",
  "Team Spirit",
  "Design Excellence",
  "Leadership",
  "Gracious Professionalism",
];

export type Nomination = { id: string; nomineeName: string; reason: string };
export type Vote = { nominationId: string };

/** Ranks an award's nominations by vote count; names a winner once it's closed. */
export function tallyAward(
  nominations: Nomination[],
  votes: Vote[],
  stage: RecognitionStage,
): { ranked: (Nomination & { voteCount: number })[]; totalVotes: number; winnerId: string | null } {
  const ranked = nominations
    .map((nom) => ({ ...nom, voteCount: votes.filter((v) => v.nominationId === nom.id).length }))
    .sort((a, b) => b.voteCount - a.voteCount || a.nomineeName.localeCompare(b.nomineeName));
  const totalVotes = votes.length;
  const winnerId = stage === "closed" && ranked[0] && ranked[0].voteCount > 0 ? ranked[0].id : null;
  return { ranked, totalVotes, winnerId };
}

export function validateAward(raw: Record<string, unknown>): { ok: true; value: { name: string; description: string } } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Award name is required" };
  if (name.length > 120) return { ok: false, error: "Award name is too long" };
  return { ok: true, value: { name, description: typeof raw.description === "string" ? raw.description.trim() : "" } };
}

// ---- request validation --------------------------------------------------

export type RecognitionAction =
  | { action: "create_award"; orgId: string; seasonYear: number; name: string; description: string }
  | { action: "set_stage"; orgId: string; id: string; stage: RecognitionStage }
  | { action: "delete_award"; orgId: string; id: string }
  | { action: "add_nomination"; orgId: string; awardId: string; nomineeName: string; reason: string }
  | { action: "delete_nomination"; orgId: string; id: string }
  | { action: "cast_vote"; orgId: string; awardId: string; nominationId: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseRecognitionAction(raw: unknown): RecognitionAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_award": {
      const validated = validateAward(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "set_stage": {
      const stage = reqStr(body.stage, "stage");
      if (!RECOGNITION_STAGES.includes(stage as RecognitionStage)) throw new Error("Invalid stage");
      return { action, orgId, id: reqStr(body.id, "id"), stage: stage as RecognitionStage };
    }
    case "delete_award":
      return { action, orgId, id: reqStr(body.id, "id") };
    case "add_nomination": {
      const nomineeName = reqStr(body.nomineeName, "nomineeName");
      return { action, orgId, awardId: reqStr(body.awardId, "awardId"), nomineeName, reason: typeof body.reason === "string" ? body.reason.trim() : "" };
    }
    case "delete_nomination":
      return { action, orgId, id: reqStr(body.id, "id") };
    case "cast_vote":
      return { action, orgId, awardId: reqStr(body.awardId, "awardId"), nominationId: reqStr(body.nominationId, "nominationId") };
    default:
      throw new Error("Unsupported recognition action");
  }
}
