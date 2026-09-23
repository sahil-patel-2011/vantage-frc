import { getFeatureSnapshot, putFeatureSnapshot } from "../offline/feature-cache";

/**
 * Team lookup with no signal.
 *
 * Research used to keep one offline copy: the last team board opened. At a venue with no
 * Wi-Fi the Teams tab opened on an empty list, search failed, and tapping any team but that
 * one failed too. This keeps three things on the device, all under the existing "intel"
 * feature cache:
 *
 *   - the event's team list          (variant "roster")
 *   - each team board once opened    (variant "team:<number>"), the raw API response
 *   - both, for every team at the event, when "Get this phone ready" runs prefetchEventTeams
 *
 * Offline search filters the saved list; it never invents a team that is not in it.
 */
export type OfflineRosterTeam = {
  teamKey: string;
  teamNumber: number;
  nickname: string | null;
  epaTotal: number | null;
  scouted: number;
};

const ROSTER_VARIANT = "roster";
const teamVariant = (teamNumber: number) => `team:${teamNumber}`;

export async function saveRoster(orgId: string, roster: OfflineRosterTeam[]): Promise<void> {
  try {
    await putFeatureSnapshot("intel", orgId, roster, ROSTER_VARIANT);
  } catch {
    // Best effort: the live list already painted.
  }
}

export async function loadRoster(orgId: string): Promise<{ roster: OfflineRosterTeam[]; cachedAt: string } | null> {
  try {
    const row = await getFeatureSnapshot<OfflineRosterTeam[]>("intel", orgId, ROSTER_VARIANT);
    return row && Array.isArray(row.data) ? { roster: row.data, cachedAt: row.cachedAt } : null;
  } catch {
    return null;
  }
}

export async function saveTeamResponse(orgId: string, teamNumber: number, data: unknown): Promise<void> {
  try {
    await putFeatureSnapshot("intel", orgId, data, teamVariant(teamNumber));
  } catch {
    // Best effort.
  }
}

export async function loadTeamResponse<T>(orgId: string, teamNumber: number): Promise<{ data: T; cachedAt: string } | null> {
  try {
    const row = await getFeatureSnapshot<T>("intel", orgId, teamVariant(teamNumber));
    return row?.data ? { data: row.data, cachedAt: row.cachedAt } : null;
  } catch {
    return null;
  }
}

/** Number prefix ("25" finds 254 and 2056) or a word in the nickname; best-rated first. */
export function searchRosterOffline(roster: readonly OfflineRosterTeam[], query: string): OfflineRosterTeam[] {
  const needle = query.trim().toLowerCase().replace(/^frc/, "");
  if (!needle) return [...roster];
  const numeric = /^\d+$/.test(needle);
  return roster
    .filter((team) =>
      numeric ? String(team.teamNumber).startsWith(needle) : (team.nickname ?? "").toLowerCase().includes(needle),
    )
    .sort((a, b) => (b.epaTotal ?? -Infinity) - (a.epaTotal ?? -Infinity) || a.teamNumber - b.teamNumber);
}

/**
 * Save the event's team list and every team's board, for a pit with no signal. Runs a few
 * requests at a time (the API is ours, but a scout's phone on venue Wi-Fi is not a server),
 * stops at `limit` teams, and reports how many boards it saved. Null when the list itself
 * could not be read — nothing is claimed as saved then.
 */
export async function prefetchEventTeams(
  orgId: string,
  options: {
    limit?: number;
    concurrency?: number;
    fetchImpl?: typeof fetch;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ teams: number; saved: number } | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const org = encodeURIComponent(orgId);
  let roster: OfflineRosterTeam[];
  try {
    const response = await doFetch(`/api/intel/teams?orgId=${org}&q=`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { roster?: OfflineRosterTeam[] };
    if (!Array.isArray(body.roster)) return null;
    roster = body.roster;
  } catch {
    return null;
  }
  await saveRoster(orgId, roster);

  const queue = roster.slice(0, Math.max(0, options.limit ?? 80));
  let saved = 0;
  let done = 0;
  const worker = async () => {
    for (let team = queue.shift(); team; team = queue.shift()) {
      try {
        const response = await doFetch(`/api/intel/teams?orgId=${org}&team=${team.teamNumber}`, { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as { team?: unknown };
          if (data.team) {
            await saveTeamResponse(orgId, team.teamNumber, data);
            saved += 1;
          }
        }
      } catch {
        // One team failing does not stop the rest.
      }
      done += 1;
      options.onProgress?.(done, Math.min(roster.length, options.limit ?? 80));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 3) }, worker));
  return { teams: roster.length, saved };
}
