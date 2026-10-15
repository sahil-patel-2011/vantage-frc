/**
 * The pre-match strategy brief: what the drive team and coach read before a match. One per team
 * per match at a time (the newest wins), shared by everyone on the team, stored in
 * match_copilot_briefs with `callouts` holding this object (the copilot's own rows hold an array).
 */

export const MATCH_BRIEF_KIND = "match-strategy-v1";
export const MATCH_BRIEF_FEATURE = "match_strategy_brief";

export type MatchBriefOpponent = {
  team: string;
  /** What they will most likely do, from scouting and their record. */
  likely: string;
  /** How they do it: where on the field, which part of the match, how often. */
  how: string;
  /** What our alliance does about it. */
  counter: string;
};

export type MatchBriefMove = {
  /** One concrete thing to do. */
  action: string;
  /** Why it matters, in numbers when the data has them. */
  why: string;
  /** Percentage points of win chance it is worth, when the model measured it. */
  gain: number | null;
};

export type MatchBriefContent = {
  headline: string;
  /** Our alliance's chance to win, 0–100, as the prediction gave it. */
  winChance: number;
  /** How to raise the odds, best first. */
  raiseOdds: MatchBriefMove[];
  /** What each opponent will most likely do, and how, and the counter. */
  opponents: MatchBriefOpponent[];
  /** Each partner's job this match. */
  partners: Array<{ team: string; role: string }>;
  phases: { auto: string; teleop: string; endgame: string };
  watchFor: string[];
};

export type MatchBriefSource = {
  /** The last match played at the event when this was written (newer data → a newer brief). */
  lastPlayedMatch: string | null;
  scoutReports: number;
  generatedAt: string;
  generatedBy: string;
  generatedByName: string | null;
  trigger: "auto" | "manual";
  model: string;
  /** "ai" when a model wrote it; "local" when Vantage composed it from the same numbers. */
  writer: "ai" | "local";
};

export type MatchBrief = MatchBriefContent & {
  kind: typeof MATCH_BRIEF_KIND;
  matchKey: string;
  alliance: "red" | "blue";
  source: MatchBriefSource;
};
