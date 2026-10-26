import {
  PLAYED_MATCH_RATING_CAVEAT,
  type RankingProjectionView,
  type RankingProjectionWhatIf,
} from "../../../lib/ranking-projection/compute-ranking-projection";
import type { RankingProjectionInitial } from "../ranking-projection-client";

const rules = {
  win: 3,
  tie: 1,
  loss: 0,
  year: 2026,
  label: "2026",
  confirmed: false,
} as const;

function whatIf(unpredicted: number): RankingProjectionWhatIf {
  return {
    rules: { ...rules },
    rankingPointSource: "record",
    standings: [
      { teamKey: "frc1678", rankingPoints: 12, played: 4, currentRank: 1 },
      { teamKey: "frc254", rankingPoints: 9, played: 4, currentRank: 2 },
      { teamKey: "frc971", rankingPoints: 6, played: 4, currentRank: 3 },
      { teamKey: "frc604", rankingPoints: 3, played: 4, currentRank: 4 },
    ],
    remaining: [
      {
        matchKey: "2026preview_qm12",
        matchNumber: 12,
        red: ["frc254", "frc604"],
        blue: ["frc1678", "frc971"],
        predicted: "blue",
        redRating: 40,
        blueRating: 70,
      },
      {
        matchKey: "2026preview_qm13",
        matchNumber: 13,
        red: ["frc254", "frc971"],
        blue: ["frc1678", "frc604"],
        predicted: unpredicted > 0 ? null : "red",
        redRating: unpredicted > 0 ? null : 55,
        blueRating: unpredicted > 0 ? null : 30,
      },
    ],
    excludedTeams: [],
    unpredictedMatches: unpredicted,
    caveats: [
      "Assumes 3 ranking points for a win and 1 for a tie; check this season's game manual.",
      "Bonus ranking points already earned aren't counted: only wins and ties are saved for this event.",
      PLAYED_MATCH_RATING_CAVEAT,
      "Teams that finish level keep their current official order: this season's tiebreakers aren't modelled.",
    ],
    ratingSource: "played",
    seedOdds: {
      iterations: 10000,
      captains: 8,
      unpredictedMatches: unpredicted,
      teams: [
        {
          teamKey: "frc254",
          captainChance: 0.42,
          firstSeedChance: 0.08,
          medianSeed: 2,
          bestLikelySeed: 1,
          worstLikelySeed: 4,
        },
      ],
    },
  };
}

function live(whatIfValue: RankingProjectionWhatIf | null, message: string | null): RankingProjectionView {
  return {
    status: "live",
    orgId: "org-preview",
    teamNumber: 254,
    teamKey: "frc254",
    eventKey: "2026preview",
    eventName: "Preview event",
    currentRank: 2,
    record: "3-1-0",
    remainingQuals: whatIfValue ? whatIfValue.remaining.length : 0,
    playedQuals: 4,
    epaTotal: null,
    computedAt: "2026-10-26T00:00:00.000Z",
    whatIf: whatIfValue,
    whatIfMessage: message,
  };
}

export function previewRankingProjection(state: string | undefined): RankingProjectionInitial {
  switch (state) {
    case "loading":
      return "loading";
    case "error":
      return "error";
    case "setup":
      return {
        status: "setup_required",
        message: "Connect an active event before projecting remaining qualification matches.",
        orgId: "org-preview",
        steps: [
          {
            id: "event",
            label: "Set active event",
            detail: "Rankings project from your active event's remaining qualification matches.",
            href: "/command?orgId=org-preview",
          },
        ],
      };
    case "empty":
      return live(null, "Every qualification match is played. This is the final seed order.");
    case "partial":
      return live(whatIf(1), null);
    case "ready":
      return live(whatIf(0), null);
    default:
      return live(whatIf(0), null);
  }
}
