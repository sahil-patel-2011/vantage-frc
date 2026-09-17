/**
 * Turn an event's played matches into per-team alliance-independence verdicts.
 *
 * Pure: takes rows as they come out of `matches_ref` plus a rating lookup, and
 * returns one verdict per team. Kept apart from the loader so the awkward parts
 * — ties, missing ratings, surrogates — can be tested without a database.
 */
import {
  allianceIndependence,
  type AllianceIndependence,
  type TeamMatchRecord,
} from "@vantage/prediction-strategy";

export type PlayedMatch = {
  matchKey: string;
  redTeams: string[];
  blueTeams: string[];
  redScore: number;
  blueScore: number;
};

/**
 * Build a verdict per team.
 *
 * A match contributes to a team only when every one of that team's two partners
 * has a rating: "partner strength" is the whole axis being split on, and
 * treating an unrated partner as zero would file a strong alliance in the weak
 * half and invert the answer.
 *
 * Ties are dropped rather than counted as half a win — with a dozen matches a
 * fabricated half-win moves the split more than it should.
 */
export function buildIndependence(
  matches: PlayedMatch[],
  ratingByTeam: Map<string, number>,
): Map<string, AllianceIndependence> {
  const byTeam = new Map<string, TeamMatchRecord[]>();

  const push = (teamKey: string, record: TeamMatchRecord) => {
    const list = byTeam.get(teamKey);
    if (list) list.push(record);
    else byTeam.set(teamKey, [record]);
  };

  for (const match of matches) {
    if (!Number.isFinite(match.redScore) || !Number.isFinite(match.blueScore)) continue;
    if (match.redScore === match.blueScore) continue;
    const redWon = match.redScore > match.blueScore;

    for (const [alliance, won] of [
      [match.redTeams, redWon],
      [match.blueTeams, !redWon],
    ] as Array<[string[], boolean]>) {
      for (const teamKey of alliance) {
        const partners = alliance.filter((other) => other !== teamKey);
        if (partners.length === 0) continue;
        let partnerRating = 0;
        let complete = true;
        for (const partner of partners) {
          const rating = ratingByTeam.get(partner);
          if (rating == null || !Number.isFinite(rating)) {
            complete = false;
            break;
          }
          partnerRating += rating;
        }
        if (!complete) continue;
        push(teamKey, { matchKey: match.matchKey, won, partnerRating });
      }
    }
  }

  const out = new Map<string, AllianceIndependence>();
  for (const [teamKey, records] of byTeam) {
    out.set(teamKey, allianceIndependence(records));
  }
  return out;
}
