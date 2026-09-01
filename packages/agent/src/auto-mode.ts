/**
 * Automode: cheap execute model vs expensive think model.
 * Sonnet-class runs tools. Opus/Fable-class is consulted only for hard thinking
 * unless the team locks the run to one model (Fixed mode).
 */

export type TaskDifficulty = "light" | "hard";
export type AutoRole = "execute" | "think";

const HARD_INTENT =
  /\b(design|gearbox|mechanism|architecture|kinematic|optimize|prove|verify|simulate|intake|elevator|swerve|wrist|turret|climber|onshape|fusion|rewrite|debug|plan\s+the|how\s+should\s+we\s+mechanically)\b/i;
const LIGHT_INTENT =
  /\b(rename|list|summarize|format|typo|short|simple|copy|rephrase|translate|label|status)\b/i;

/** Hard CAD/code/agent work prefers Opus/Fable; short execution stays on Sonnet. */
export function classifyTaskDifficulty(text: string, feature?: string | null): TaskDifficulty {
  const t = text.trim();
  const f = (feature ?? "").toLowerCase();
  const agentic = f === "cad" || f === "coding" || f === "code" || f === "agent" || f.startsWith("bugbot");
  if (agentic) {
    if (t.length < 220 && LIGHT_INTENT.test(t) && !HARD_INTENT.test(t)) return "light";
    return "hard";
  }
  if (HARD_INTENT.test(t) || t.length > 900) return "hard";
  return "light";
}

export function preferredTierForDifficulty(difficulty: TaskDifficulty): "high" | "mid" {
  return difficulty === "hard" ? "high" : "mid";
}

/** Consulting is on in Automode unless the org/user locked the run to one model. */
export function consultingAllowed(input: {
  mode: "fixed" | "automode";
  consultEnabled?: boolean | null;
  lockRun?: boolean;
}): boolean {
  if (input.lockRun) return false;
  if (input.mode === "fixed") return false;
  return input.consultEnabled !== false;
}
