import type { StrategyView } from "../strategy/types";
import type { MatchBriefContent } from "./types";

type LiveView = Extract<StrategyView, { status: "live" }>;

const team = (teamKey: string) => teamKey.replace(/^frc/, "");

/**
 * The brief without a model: the same sections, written from the engine's own measured levers,
 * scouting tendencies and plan. Used when the team has no AI connected (or the model's answer was
 * unusable), so every team still gets a brief, and it never says more than the numbers do.
 */
export function composeLocalMatchBrief(view: LiveView): MatchBriefContent {
  const ours = view.ourAlliance;
  const winChance = Math.round((ours === "red" ? view.prediction.pRed : view.prediction.pBlue) * 100);
  const opponentsKeys = ours === "red" ? view.blue : view.red;
  const partnerKeys = ours === "red" ? view.red : view.blue;
  const tendencies = new Map(view.tendencies.map((row) => [row.teamKey, row]));
  const ops = new Map(view.operations.map((op) => [op.teamKey, op]));

  const raiseOdds: MatchBriefContent["raiseOdds"] = view.levers.slice(0, 4).map((lever) => ({ action: lever.title, why: lever.detail, gain: lever.gain }));
  for (const line of view.playbook.priorities) {
    if (raiseOdds.length >= 4) break;
    if (!raiseOdds.some((move) => move.action === line)) raiseOdds.push({ action: line, why: "From this match's plan.", gain: null });
  }
  if (!raiseOdds.length) {
    raiseOdds.push({ action: "Scout these opponents' next matches", why: "There isn't enough measured about this match yet to say what would change the result.", gain: null });
  }

  const opponents = opponentsKeys.map((teamKey) => {
    const tendency = tendencies.get(teamKey);
    const op = ops.get(teamKey);
    const history = view.teamTrends?.[teamKey]?.lines?.[0];
    const likely = tendency?.labels.length
      ? `Scouts mostly see them ${tendency.labels.slice(0, 2).join(" and ").toLowerCase()}.`
      : history ?? "Not scouted enough yet to say what they'll do.";
    const how = tendency?.evidence[0] ?? (op?.scoutSample ? `${op.scoutSample} scouted matches.` : "");
    const counter = op?.defenseLikely
      ? "Expect defense; keep a clear path for our main scorer."
      : (op?.foulRate ?? 0) >= 0.5
        ? "They draw fouls; stay clean and let them give up points."
        : "Watch their first cycle and adjust.";
    return { team: team(teamKey), likely, how, counter };
  });

  const partners = partnerKeys.map((teamKey) => {
    const op = ops.get(teamKey);
    const strongest =
      op == null
        ? null
        : [
            ["auto", op.autoCapability ?? 0],
            ["teleop scoring", op.teleopCapability ?? 0],
            ["endgame", op.endgameCapability ?? 0],
          ].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const role = strongest && Number(strongest[1]) >= 0.35 ? `Lead on ${strongest[0]}, where scouts see them strongest.` : "Role to confirm in the queue.";
    return { team: team(teamKey), role };
  });

  return {
    headline: `${winChance}% to win. ${raiseOdds[0]!.action}.`.replace(/\.\.$/, "."),
    winChance,
    raiseOdds,
    opponents,
    partners,
    phases: {
      auto: view.playbook.checkpoints[0] ?? "",
      teleop: view.playbook.priorities[0] ?? "",
      endgame: view.playbook.checkpoints[1] ?? "",
    },
    watchFor: [...view.playbook.risksToMitigate, ...view.matchup.considerations].slice(0, 3),
  };
}
