/**
 * Do not stop until the user's ask is finished, checked, and reported.
 * Simulated functionality = grounded checks against tools + answer text,
 * never invented CAD/physics results.
 */

const CAD_INTENT =
  /\b(cad|onshape|fusion|design|mechanism|gearbox|intake|elevator|arm|wrist|climber|swerve|shooter)\b/i;

export type GoalTask = { id: string; label: string };

export type SimulatedCheck = { ok: boolean; notes: string[] };

export type CompletionReport = {
  what: string[];
  why: string[];
  left: string[];
  verified: boolean;
  simulated: SimulatedCheck;
};

export function extractGoalTasks(goal: string): GoalTask[] {
  const lines = goal
    .split(/\n|;|\.(?=\s+[A-Z])/)
    .map((line) => line.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((line) => line.length >= 8);
  const unique = [...new Set(lines)].slice(0, 8);
  if (!unique.length) {
    return [{ id: "goal", label: goal.trim().slice(0, 200) || "Complete the requested work" }];
  }
  return unique.map((label, index) => ({ id: `t${index + 1}`, label: label.slice(0, 200) }));
}

export function goalNeedsDesignResearch(goal: string, feature?: string | null): boolean {
  const f = (feature ?? "").toLowerCase();
  if (f === "cad") return true;
  return CAD_INTENT.test(goal);
}

export function evaluateSimulatedFunctionality(input: {
  goal: string;
  answer: string;
  toolsUsed: string[];
  feature?: string | null;
}): SimulatedCheck {
  const failures: string[] = [];
  const notes: string[] = [];
  const answer = input.answer.trim();
  const tools = new Set(input.toolsUsed);
  const needsResearch = goalNeedsDesignResearch(input.goal, input.feature);
  const researched = tools.has("design.research") || tools.has("web.search") || tools.has("web.fetch");
  if (needsResearch && researched) {
    notes.push("Research tools ran before the design recommendation.");
  }
  if (needsResearch && !researched) {
    failures.push("No mechanical/web research ran before proposing a design.");
  }
  if (
    needsResearch &&
    !/\b(cots|belt|chain|gear|bearing|tube|shaft|neo|falcon|kraken|vp|versaplanetary|mk4|swerve)\b/i.test(
      answer,
    )
  ) {
    failures.push("Answer does not name a real mechanism, COTS, or transmission — too vague to treat as a design.");
  }
  if (!/\b(what i did|why|what'?s left|verification|checked)\b/i.test(answer) && answer.length < 80) {
    failures.push("Answer is too short to show work, rationale, and leftovers.");
  }
  if (/TODO|not sure|i guess|probably just|as an ai/i.test(answer) && needsResearch) {
    failures.push("Answer still guesses instead of citing research or team data.");
  }
  return { ok: failures.length === 0, notes: [...notes, ...failures] };
}

export function evaluateRunCompletion(input: {
  goal: string;
  answer: string;
  toolsUsed: string[];
  feature?: string | null;
}): CompletionReport {
  const tasks = extractGoalTasks(input.goal);
  const haystack = `${input.answer}\n${input.toolsUsed.join(" ")}`.toLowerCase();
  const done: string[] = [];
  const left: string[] = [];
  for (const task of tasks) {
    const tokens = task.label.toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 4);
    const hit = tokens.length === 0 || tokens.some((token) => haystack.includes(token));
    if (hit) done.push(task.label);
    else left.push(task.label);
  }
  const simulated = evaluateSimulatedFunctionality(input);
  if (!simulated.ok) {
    for (const note of simulated.notes) {
      if (!left.includes(note)) left.push(note);
    }
  }
  const why = [
    input.toolsUsed.length
      ? `Tools used: ${[...new Set(input.toolsUsed)].join(", ")}.`
      : "No tools were used.",
    goalNeedsDesignResearch(input.goal, input.feature)
      ? "Mechanical design must be grounded in current FRC practice, not guessed geometry."
      : "Work is complete only when every asked item is addressed and checked.",
  ];
  const verified = left.length === 0 && simulated.ok;
  return { what: done, why, left, verified, simulated };
}

export function formatCompletionReport(report: CompletionReport, answer: string): string {
  const body = answer.trim();
  const alreadyStructured = /\bwhat i did\b/i.test(body) && /\bwhat'?s left\b/i.test(body);
  const sections = [
    alreadyStructured ? body : body,
    "",
    "## What I did",
    report.what.length ? report.what.map((line) => `- ${line}`).join("\n") : "- (nothing verified yet)",
    "",
    "## Why",
    report.why.map((line) => `- ${line}`).join("\n"),
    "",
    "## What's left",
    report.left.length ? report.left.map((line) => `- ${line}`).join("\n") : "- Nothing left — request looks finished.",
    "",
    "## Verification",
    `- ${report.verified ? "Checked against the ask and simulated-functionality gates." : "Not finished — keep going."}`,
    ...report.simulated.notes.map((note) => `- ${note}`),
  ];
  return sections.join("\n").trim();
}

export function shouldRefuseEarlyFinal(
  report: CompletionReport,
  goal: string,
  feature?: string | null,
): boolean {
  if (!goalNeedsDesignResearch(goal, feature)) return false;
  return !report.verified;
}
