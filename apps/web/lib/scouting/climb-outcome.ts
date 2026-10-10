/** A missing outcome never describes a robot's capability or intent. */
export type ClimbOutcome = "successful" | "failed" | "not_attempted" | "no_success" | "unseen";

const successful = new Set(["l1", "l2", "l3", "l4", "low", "mid", "high", "deep", "shallow", "climbed", "success", "successful", "yes", "true", "1"]);
const failed = new Set(["failed", "attempted_failed", "failed_attempt", "fell", "failed_climb", "climb_failed"]);
const notAttempted = new Set(["not_attempted", "no_attempt", "did_not_attempt", "did_not_attempt_climb"]);
const noSuccess = new Set(["none", "no", "false", "0", "park", "parked", "did_not_climb", "no_climb"]);

export function climbOutcome(value: unknown): ClimbOutcome {
  if (typeof value === "boolean") return value ? "successful" : "no_success";
  if (typeof value === "number") return !Number.isFinite(value) || value < 0 ? "unseen" : value > 0 ? "successful" : "no_success";
  if (typeof value !== "string") return "unseen";
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (successful.has(key)) return "successful";
  if (failed.has(key)) return "failed";
  if (notAttempted.has(key)) return "not_attempted";
  if (noSuccess.has(key)) return "no_success";
  return "unseen";
}

export function climbSucceeded(value: unknown): boolean | null {
  const outcome = climbOutcome(value);
  return outcome === "unseen" ? null : outcome === "successful";
}

/** Resolve success separately from height or intent, preserving tied success votes. */
export function combineClimbOutcomes(outcomes: readonly ClimbOutcome[]): ClimbOutcome {
  const known = outcomes.filter(value => value !== "unseen");
  if (!known.length) return "unseen";
  const successes = known.filter(value => value === "successful").length;
  if (successes * 2 === known.length) return "unseen";
  if (successes * 2 > known.length) return "successful";
  const negatives = known.filter(value => value !== "successful");
  for (const outcome of ["failed", "not_attempted"] as const) {
    if (negatives.every(value => value === outcome)) return outcome;
  }
  // Non-success is known, but conflicting attempt reports cannot establish intent.
  return "no_success";
}
