/**
 * One card per opponent for the pre-match briefing: the team, two or three plain lines a
 * student can read while queueing, and a "likely plan" tag. Everything comes from the team's
 * own scouting (the saved plan's per-robot capabilities and tendency labels), the ratings sync,
 * and notes the team wrote. Nothing is invented: an opponent nobody has scouted says so.
 *
 * The statistics behind the lines ("Scout reliability 89% (n=7.6)", "scout quality adjusted")
 * are kept as `evidence` for the briefing's "How we got this" section, not shown on the card.
 */

import type { MatchCopilotTeam } from "../match-copilot/types";
import { intelTags } from "../display/match-intel";
import { plainStrategyText } from "./plain-text";
import { capabilityLabel } from "./plan-sections";
import type {
  BriefingCounterBook,
  BriefingDefensePlan,
  BriefingScoutedTeam,
  BriefingTendency,
  BriefingWatchNote,
} from "./types";

export type OpponentCard = {
  team: string;
  nickname: string | null;
  /** "Ranked 3 · rating 57.5", or null without synced numbers. */
  standing: string | null;
  /** Two or three plain lines from scouting. Empty when nothing is scouted. */
  lines: string[];
  /** "Likely plan: cycles, may defend", or null when scouting cannot say. */
  likelyPlan: string | null;
  /** What the team itself wrote: watchlist note, counter plan, defense plan. */
  notes: string[];
  /** Scouting entries behind the lines (0 = not scouted). */
  scoutSample: number;
  /** The statistics behind the lines, for "How we got this". */
  evidence: string[];
};

const strip = (key: string) => key.replace(/^frc/i, "");

function phaseLine(row: BriefingScoutedTeam | undefined, labels: string[]): string | null {
  const auto = capabilityLabel(row?.autoCapability ?? null);
  const teleop = capabilityLabel(row?.teleopCapability ?? null);
  const strong = [auto === "strong" ? "auto" : null, teleop === "strong" ? "teleop" : null].filter(Boolean);
  if (strong.length === 2) return "Strong scorer in auto and teleop";
  if (teleop === "strong") return "Strong teleop scorer";
  if (auto === "strong") return teleop === "solid" ? "Strong auto, steady teleop" : "Strong auto";
  if (teleop === "solid" || auto === "solid") return "Steady scorer";
  if (teleop === "developing" || auto === "developing") return "Still finding its scoring";
  const tagged = intelTags(labels.filter((label) => /auto|teleop/.test(label)));
  return tagged.length ? tagged.join(" · ") : null;
}

function endgameLine(row: BriefingScoutedTeam | undefined, labels: string[]): string | null {
  const endgame = capabilityLabel(row?.endgameCapability ?? null);
  if (endgame === "strong") return "Reliable endgame";
  if (endgame === "solid") return "Usually does the endgame";
  if (endgame === "developing") return "Endgame is hit or miss";
  if (labels.includes("endgame-leaning")) return "Strong endgame";
  if (labels.includes("scout-endgame-capable")) return "Does the endgame";
  return null;
}

function roughLine(row: BriefingScoutedTeam | undefined, labels: string[]): string | null {
  const parts: string[] = [];
  if (row?.defenseLikely || labels.includes("defense-capable")) parts.push("Plays defense");
  if (labels.includes("contact-aware")) parts.push("physical");
  if (row?.foulRate != null && row.foulRate >= 0.5) parts.push(`~${Math.round(row.foulRate * 10) / 10} fouls a match`);
  else if (labels.includes("foul-prone")) parts.push("draws fouls");
  if (labels.includes("reliability-risk")) parts.push("breaks down sometimes");
  if (!parts.length) return null;
  const [first, ...rest] = parts;
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(" · ");
}

function planTag(row: BriefingScoutedTeam | undefined, labels: string[]): string | null {
  const parts: string[] = [];
  const teleop = capabilityLabel(row?.teleopCapability ?? null);
  const auto = capabilityLabel(row?.autoCapability ?? null);
  const endgame = capabilityLabel(row?.endgameCapability ?? null);
  if (teleop === "strong" || teleop === "solid" || labels.includes("scout-teleop-capable")) parts.push("cycles");
  else if (auto === "strong" || auto === "solid" || labels.includes("autonomous-leaning")) parts.push("scores early in auto");
  if (row?.defenseLikely || labels.includes("defense-capable")) parts.push("may defend");
  else if (endgame === "strong" || labels.includes("endgame-leaning")) parts.push("goes for the endgame");
  return parts.length ? `Likely plan: ${parts.slice(0, 2).join(", ")}` : null;
}

export function buildOpponentCards(input: {
  opponentKeys: string[];
  opponentTeams: MatchCopilotTeam[];
  scouted: BriefingScoutedTeam[];
  tendencies: BriefingTendency[];
  watchNotes: BriefingWatchNote[];
  counterBooks: BriefingCounterBook[];
  defensePlans: BriefingDefensePlan[];
}): OpponentCard[] {
  return input.opponentKeys.map((key) => {
    const team = strip(key);
    const rating = input.opponentTeams.find((row) => row.teamKey === key);
    const row = input.scouted.find((entry) => entry.teamKey === key && entry.scoutSample > 0);
    const tendency = input.tendencies.find((entry) => entry.teamKey === key);
    const labels = tendency?.labels ?? [];

    const lines = [phaseLine(row, labels), endgameLine(row, labels), roughLine(row, labels)].filter(
      (line): line is string => Boolean(line),
    );
    const pitNote = row?.pitNotes.find((note) => note.trim());
    if (pitNote && lines.length < 3) lines.push(`Scout note: ${pitNote}`);

    const standingParts: string[] = [];
    if (rating?.rank != null) standingParts.push(`Ranked ${rating.rank}`);
    if (rating?.epaTotal != null) standingParts.push(`rating ${rating.epaTotal.toFixed(1)}`);

    const notes: string[] = [];
    for (const note of input.watchNotes.filter((entry) => entry.teamKey === key).slice(0, 1)) {
      notes.push(`Our note: ${note.note}`);
    }
    const book = input.counterBooks.find((entry) => entry.teamKey === key);
    if (book && (book.counterPlan || book.summary)) notes.push(`How to beat them: ${book.counterPlan || book.summary}`);
    const defense = input.defensePlans.find((plan) => String(plan.opponentTeamNumber) === team);
    if (defense) {
      const call =
        defense.recommendation === "play_defense"
          ? "play defense on them"
          : defense.recommendation === "stay_offense"
            ? "stay on offense"
            : "defend only if needed";
      notes.push(`Defense plan: ${call}${defense.assignedDefender === "us" ? " (we defend)" : ""}`);
    }

    const evidence: string[] = [];
    if (row) evidence.push(`${team}: ${row.scoutSample} scouting ${row.scoutSample === 1 ? "entry" : "entries"}`);
    for (const line of tendency?.evidence ?? []) evidence.push(`${team}: ${plainStrategyText(line)}`);
    if (book) {
      for (const entry of book.tendencies) {
        evidence.push(`${team}: ${entry.field} about ${Math.round(entry.average * 10) / 10} over ${entry.sampleSize} matches`);
      }
    }

    return {
      team,
      // "Team 1678" next to "1678" says the number twice.
      nickname: rating?.nickname && rating.nickname.trim() !== `Team ${team}` ? rating.nickname : null,
      standing: standingParts.length ? standingParts.join(" · ") : null,
      lines: lines.slice(0, 3),
      likelyPlan: planTag(row, labels),
      notes,
      scoutSample: row?.scoutSample ?? 0,
      evidence,
    };
  });
}
