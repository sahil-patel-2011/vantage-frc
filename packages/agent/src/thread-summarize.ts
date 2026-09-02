/**
 * Compress prior turns from ONE org thread so the next model call still has
 * the story without shipping the whole transcript — or another team's.
 *
 * The digest is extractive: it keeps the caller's own words, in order, and
 * never invents a recap. The LLM summarize path exists for the async job and
 * still only sees the turns the caller handed it.
 */

export type ThreadTurn = {
  role: "user" | "assistant";
  content: string;
};

export function digestThreadTurns(turns: readonly ThreadTurn[], charBudget = 1_200): string {
  const kept: string[] = [];
  let used = 0;
  for (const turn of turns) {
    const line = `${turn.role}: ${turn.content.trim()}`.slice(0, 400);
    if (!line.slice(turn.role.length + 2)) continue;
    if (used + line.length > charBudget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept.join("\n");
}

export function threadSummarizeMessage(orgId: string, turns: readonly ThreadTurn[]): string {
  const digest = digestThreadTurns(turns);
  return [
    `Summarize ONLY the following conversation from organization ${orgId}.`,
    "Do not add facts that are not in these turns. Do not mention any other team.",
    "Return a short recap a teammate could pick up from.",
    "",
    digest || "(no prior turns)",
  ].join("\n");
}
