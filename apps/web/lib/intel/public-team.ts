import { readPlatformTbaAuthKey } from "@vantage/reference";

/** The public facts about a team, for a lookup Vantage's shared team list can't answer yet. */
export type PublicTeam = {
  teamNumber: number;
  nickname: string | null;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  rookieYear: number | null;
  tbaHref: string;
};

type TbaTeam = {
  team_number?: number;
  nickname?: string | null;
  city?: string | null;
  state_prov?: string | null;
  country?: string | null;
  rookie_year?: number | null;
};

const TBA_BASE = "https://www.thebluealliance.com/api/v3";

/**
 * One team from The Blue Alliance, for a person who typed its number. Searching "254" used to end
 * at "Team 254 isn't in Vantage's team list yet" with nothing else. This answers with the team's
 * public profile and says the match data comes once one of its events syncs.
 *
 * Shared-cache rules: one request per team per day at most (Next's data cache keeps the answer
 * for 24 hours across every team that asks), a short timeout, nothing written to the reference
 * tables (that stays the ingest worker's job), and null on any failure or with no TBA key.
 */
export async function fetchPublicTeam(
  teamNumber: number,
  fetcher: typeof fetch = fetch,
): Promise<PublicTeam | null> {
  if (!Number.isInteger(teamNumber) || teamNumber <= 0 || teamNumber > 99_999) return null;
  const key = readPlatformTbaAuthKey();
  if (!key) return null;
  try {
    const response = await fetcher(`${TBA_BASE}/team/frc${teamNumber}`, {
      headers: { "X-TBA-Auth-Key": key, accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
      next: { revalidate: 86_400 },
    } as RequestInit);
    if (!response.ok) return null;
    const team = (await response.json()) as TbaTeam;
    if (team.team_number !== teamNumber) return null;
    return {
      teamNumber,
      nickname: team.nickname?.trim() || null,
      city: team.city?.trim() || null,
      stateProv: team.state_prov?.trim() || null,
      country: team.country?.trim() || null,
      rookieYear: typeof team.rookie_year === "number" ? team.rookie_year : null,
      tbaHref: `https://www.thebluealliance.com/team/${teamNumber}`,
    };
  } catch {
    return null;
  }
}
