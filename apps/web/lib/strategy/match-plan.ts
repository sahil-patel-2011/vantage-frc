import type { TeamOperationalSignal, WinLever } from "@vantage/prediction-strategy";

/**
 * The game plan for this match, in plain words, from this match's own numbers.
 *
 * The engine's playbook was the same four lines for every match ("Execute the highest-tested
 * autonomous routine…", "Protect cycle consistency…"). A drive coach reading Qual 28, 31 and 32
 * saw one plan. These lines come from the measured levers (what would move the win chance) and
 * from scouting on the five other robots, so each match says something different, or nothing:
 * an empty list means the caller keeps the general tips.
 */
export function matchSpecificPlan(input: {
  levers: WinLever[];
  ourTeamKey: string;
  partners: string[];
  opponents: string[];
  operations: TeamOperationalSignal[];
  /** Our alliance's ratings, to pick a defender when scouting cannot. */
  ourRatings?: Array<{ teamKey: string; rating: number }>;
}): string[] {
  const num = (teamKey: string) => teamKey.replace(/^frc/i, "");
  const signal = (teamKey: string) => input.operations.find((op) => op.teamKey === teamKey);
  const lines: string[] = [];

  // The measured levers, biggest first. The exchange-rate lever ("what ten more points is
  // worth") is a reference for pricing other ideas, not a step.
  const levers = input.levers
    .filter((lever) => lever.id !== "scoring-rate" && lever.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 2);
  for (const lever of levers) {
    const target = lever.id === "defend-top-opponent" ? /^Defend (\S+)/.exec(lever.title)?.[1] : undefined;
    const defender = target ? pickDefender(input) : null;
    if (target && defender) {
      // "Defend 118" left the coach to work out which of our three goes: name one and say why.
      const others = [input.ourTeamKey, ...input.partners].filter((key) => key !== defender.teamKey).map(num);
      lines.push(
        `${num(defender.teamKey)} defends ${target}: ${firstSentence(lever.detail)} (+${round1(lever.gain)}% win chance). ` +
          `${num(defender.teamKey)} ${defender.reason}; ${others.join(" and ")} keep scoring.`,
      );
      continue;
    }
    lines.push(`${lever.title}: ${firstSentence(lever.detail)} (+${round1(lever.gain)}% win chance)`);
  }

  // A partner who has broken down: the plan has to survive without them.
  const shaky = input.partners
    .map((teamKey) => ({ teamKey, reliability: signal(teamKey)?.reliability }))
    .filter((row): row is { teamKey: string; reliability: number } => row.reliability != null && row.reliability < 80)
    .sort((a, b) => a.reliability - b.reliability)[0];
  if (shaky) {
    lines.push(
      `${num(shaky.teamKey)} broke down in ${100 - Math.round(shaky.reliability)}% of the matches we scouted: plan to win if they stop.`,
    );
  }

  // Our own fouls, unless a lever already says so.
  const ours = signal(input.ourTeamKey);
  if (!levers.some((lever) => lever.id === "penalties") && ours?.foulRate != null && ours.foulRate >= 1) {
    lines.push(`Keep fouls down: scouts saw us give about ${round1(ours.foulRate)} a match.`);
  }

  // An opponent who defends: keep a lane open.
  const defender = input.opponents.find((teamKey) => signal(teamKey)?.defenseLikely);
  if (defender) lines.push(`${num(defender)} tends to play defense: keep one scoring lane they can't block.`);

  // A strong endgame across the field decides close matches.
  const closer = input.opponents
    .map((teamKey) => ({ teamKey, endgame: signal(teamKey)?.endgameCapability }))
    .filter((row): row is { teamKey: string; endgame: number } => row.endgame != null && row.endgame >= 0.7)
    .sort((a, b) => b.endgame - a.endgame)[0];
  if (closer) {
    lines.push(`${num(closer.teamKey)} finishes the endgame about ${Math.round(closer.endgame * 100)}% of the time: start ours early.`);
  }

  return lines.slice(0, 4);
}

/**
 * Which of our three robots should play defense: one scouting says already defends, else the one
 * that scores least in teleop, else the lowest rated. Null when nothing tells them apart.
 */
function pickDefender(input: {
  ourTeamKey: string;
  partners: string[];
  operations: TeamOperationalSignal[];
  ourRatings?: Array<{ teamKey: string; rating: number }>;
}): { teamKey: string; reason: string } | null {
  const ours = [input.ourTeamKey, ...input.partners];
  const signal = (teamKey: string) => input.operations.find((op) => op.teamKey === teamKey && op.scoutSample > 0);
  const teleop = (teamKey: string) => signal(teamKey)?.teleopCapability;

  const defenders = ours.filter((teamKey) => signal(teamKey)?.defenseLikely);
  if (defenders.length) {
    const pick = [...defenders].sort((a, b) => (teleop(a) ?? 1) - (teleop(b) ?? 1))[0]!;
    return { teamKey: pick, reason: "already plays defense in the matches we scouted" };
  }

  const scored = ours
    .map((teamKey) => ({ teamKey, teleop: teleop(teamKey) }))
    .filter((row): row is { teamKey: string; teleop: number } => row.teleop != null)
    .sort((a, b) => a.teleop - b.teleop);
  if (scored.length === ours.length && scored.length > 1 && scored[scored.length - 1]!.teleop - scored[0]!.teleop >= 0.1) {
    return { teamKey: scored[0]!.teamKey, reason: "scores the least of our three in teleop" };
  }

  const rated = ours
    .map((teamKey) => ({ teamKey, rating: input.ourRatings?.find((row) => row.teamKey === teamKey)?.rating }))
    .filter((row): row is { teamKey: string; rating: number } => row.rating != null && row.rating > 0)
    .sort((a, b) => a.rating - b.rating);
  if (rated.length === ours.length && rated.length > 1 && rated[rated.length - 1]!.rating - rated[0]!.rating >= 3) {
    return { teamKey: rated[0]!.teamKey, reason: "adds the fewest points of our three" };
  }
  return null;
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const end = trimmed.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? trimmed.slice(0, end) : trimmed;
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

function round1(value: number): string {
  return String(Math.round(value * 10) / 10);
}
