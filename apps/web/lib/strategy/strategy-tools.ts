/**
 * The Strategy tab's "More tools" list, grouped by the job a drive coach or strategy lead is
 * doing, most-used first in each group, with one plain line on what each tool answers.
 *
 * It was twenty names in one list ("Pairwise", "Justifier", "Counter-book", "Match delta"),
 * most with no description, so nobody could tell which one answered "what will the opponents
 * do?". The answer to that now lives in the pre-match briefing; these tools are the detail.
 */

export type ToolGroup = { label: string; ids: string[] };

export const STRATEGY_TOOL_GROUPS: ToolGroup[] = [
  {
    label: "Before a match",
    ids: [
      "match-strategy-cards",
      "counter-book",
      "defense-planner",
      "opponent-watchlist",
      "match-notes-timeline",
      "match-sim",
      "video",
      "match-video-index",
      "match-delta-watcher",
    ],
  },
  {
    label: "Alliance selection",
    ids: [
      "pick-clock",
      "picklist-collab",
      "alliance-partner-brief",
      "chemistry",
      "alliance-sim",
      "pairwise",
      "picklist-justifier",
      "team-tags",
    ],
  },
  {
    label: "Research",
    ids: ["dossier", "intel", "ranking-projection", "epa-trend-alerts", "overnight-intel", "district-advancement"],
  },
];

const BLURBS: Record<string, string> = {
  "match-briefing": "Everything for the next match on one screen",
  "alliance-selection-desk": "Run alliance selection live",
  picks: "Rank the teams you would pick",
  "match-strategy-cards": "A printable game plan for one match",
  "counter-book": "How to beat one opponent, from your scouting",
  "defense-planner": "Whether to play defense, and on whom",
  "opponent-watchlist": "Notes on teams to keep an eye on",
  "match-notes-timeline": "What the drive team noted after each match",
  "match-sim": "Play out a match with different lineups",
  video: "Tag match video with notes",
  "match-video-index": "Find a moment in match video",
  "match-delta-watcher": "What changed since a team's last match",
  "pick-clock": "The timer and board during selection",
  "picklist-collab": "Build the pick order together",
  "alliance-partner-brief": "One page on a possible partner",
  chemistry: "How well two robots play together",
  "alliance-sim": "Try an alliance before you pick it",
  pairwise: "Rank teams by comparing two at a time",
  "picklist-justifier": "Why each team sits where it does",
  "team-tags": "Quick labels from the drive team",
  dossier: "Everything known about one team",
  intel: "Ask a question about any team or event",
  "ranking-projection": "Where teams are likely to finish",
  "epa-trend-alerts": "Teams whose rating jumped or fell",
  "overnight-intel": "What changed at the event overnight",
  "district-advancement": "District points and who advances",
};

/** One line on what a Strategy tool is for, or undefined when there is none. */
export function strategyToolBlurb(id: string): string | undefined {
  return BLURBS[id];
}
