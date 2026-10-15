import type { StrategyView } from "../strategy/types";

type LiveView = Extract<StrategyView, { status: "live" }>;

const num = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits;
const team = (teamKey: string) => teamKey.replace(/^frc/, "");
const pct = (value: number | null | undefined) => (value == null ? null : Math.round(value * 100));

/** The numbers the brief may use, nothing else, in a compact shape the model reads easily. */
export function matchBriefFacts(view: LiveView) {
  const ours = view.ourAlliance;
  const theirs = ours === "red" ? "blue" : "red";
  const winOurs = ours === "red" ? view.prediction.pRed : view.prediction.pBlue;
  const ops = new Map(view.operations.map((op) => [op.teamKey, op]));
  const tendencies = new Map(view.tendencies.map((row) => [row.teamKey, row]));
  const contribution = new Map(
    [...view.allianceBreakdown.red, ...view.allianceBreakdown.blue].map((row) => [row.teamKey, row]),
  );
  const describe = (teamKey: string) => {
    const brief = [...view.matchup.red, ...view.matchup.blue].find((row) => row.teamKey === teamKey);
    const op = ops.get(teamKey);
    return {
      team: team(teamKey),
      rating: num(contribution.get(teamKey)?.rating ?? brief?.epa ?? null),
      autoPoints: num(brief?.autoEpa),
      endgamePoints: num(brief?.endgameEpa),
      record: brief?.record ?? null,
      rank: brief?.rank ?? null,
      scoutedMatches: op?.scoutSample ?? brief?.scoutSample ?? 0,
      reliabilityPct: num(op?.reliability ?? brief?.reliability ?? null, 0),
      foulRate: num(op?.foulRate ?? brief?.foulRate ?? null, 2),
      autoCapability: pct(op?.autoCapability),
      teleopCapability: pct(op?.teleopCapability),
      endgameCapability: pct(op?.endgameCapability),
      playsDefense: op?.defenseLikely ?? null,
      pitNotes: (op?.pitNotes ?? []).slice(0, 3),
      scoutedTendencies: tendencies.get(teamKey)?.labels ?? [],
      tendencyEvidence: (tendencies.get(teamKey)?.evidence ?? []).slice(0, 3),
      history: view.teamTrends?.[teamKey]?.lines ?? [],
    };
  };
  const alliance = (side: "red" | "blue") => (side === "red" ? view.red : view.blue);
  return {
    match: `${view.compLevel === "qm" ? "Qualification" : "Playoff"} ${view.matchNumber}`,
    event: view.eventName ?? view.eventKey,
    ourTeam: String(view.teamNumber),
    ourAlliance: ours,
    ourWinChancePct: Math.round(winOurs * 100),
    winChanceRangePct: [pct(ours === "red" ? view.prediction.confidenceLow : 1 - view.prediction.confidenceHigh), pct(ours === "red" ? view.prediction.confidenceHigh : 1 - view.prediction.confidenceLow)],
    us: alliance(ours).map(describe),
    them: alliance(theirs).map(describe),
    measuredLevers: view.levers.slice(0, 6).map((lever) => ({ action: lever.title, detail: lever.detail, winChanceGainPct: lever.gain })),
    enginePlan: view.playbook.priorities.slice(0, 6),
    risks: view.playbook.risksToMitigate.slice(0, 4),
    strengths: view.playbook.strengthsToProtect.slice(0, 4),
    considerations: view.matchup.considerations.slice(0, 4),
    gameRules: view.gameRules ? { season: view.gameRules.seasonYear } : null,
  };
}

/**
 * The instruction for the model. Written for Claude Haiku 5.5 (the team default): short
 * rules, the exact JSON shape, and a hard line on using only the numbers provided. The brief
 * is for high-school drive teams minutes before a match: concrete, specific to these six robots,
 * full sentences, not clipped telegraph style.
 */
export function buildMatchBriefPrompt(view: LiveView): string {
  const facts = matchBriefFacts(view);
  return [
    "You are the strategy lead for an FRC (FIRST Robotics Competition) team, writing the pre-match brief the drive team and coach read in the queue.",
    "",
    "Rules:",
    "- Use only the facts in the JSON below. Never invent numbers, scores, records, or robot abilities. If something is unknown (null or empty), don't guess; say what to watch for instead.",
    "- Be specific to these six robots and this match. Name teams by number.",
    "- Write in plain, complete sentences a high-school student understands. No jargon like EPA, OPR, or Statbotics; say \"scores about N points\" or \"one of the stronger teams here\" instead.",
    "- raiseOdds: 3 to 5 moves, best first. Prefer the measured levers (keep their win-chance gain as gain); add others only when the facts support them (gain null).",
    "- opponents: one entry per opposing team: what they will most likely do, how (where, which part of the match, how often), and our counter.",
    "- partners: each partner's job this match, including our team.",
    "- phases: what our alliance does in auto, teleop, and endgame.",
    "- watchFor: 2 to 4 things to watch for during the match that could change the plan.",
    "- winChance: copy ourWinChancePct exactly.",
    "",
    "Reply with only this JSON, no other text:",
    '{"headline": string, "winChance": number, "raiseOdds": [{"action": string, "why": string, "gain": number|null}], "opponents": [{"team": string, "likely": string, "how": string, "counter": string}], "partners": [{"team": string, "role": string}], "phases": {"auto": string, "teleop": string, "endgame": string}, "watchFor": [string]}',
    "",
    "Facts:",
    JSON.stringify(facts),
  ].join("\n");
}
