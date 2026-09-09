import type { StatboticsClient } from "./statbotics-client";
import type { TbaGetter } from "./worker";

/**
 * Build a team's public dossier from The Blue Alliance and Statbotics.
 *
 * Pure with respect to storage: it takes the two clients and returns a
 * payload; the app decides where it lives. Every field is either what a
 * source said or null. Where a source is unreachable the dossier says so in
 * `sources` and carries on with what the other one knows — a team with no
 * Statbotics answer is not a team with no results, and the page must be able
 * to tell the difference.
 *
 * Call budget is bounded and small — TBA: profile, years, awards, then two
 * calls per recent season; Statbotics: two — because TBA is a shared,
 * rate-limited cache for the whole platform and this runs once per team per
 * week, not on every page view.
 */

export type DossierProfile = {
  nickname: string | null;
  name: string | null;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  rookieYear: number | null;
  website: string | null;
  schoolName: string | null;
};

export type DossierAward = { year: number; eventKey: string; eventName: string | null; name: string };

export type DossierEvent = {
  year: number;
  eventKey: string;
  name: string | null;
  week: number | null;
  rank: number | null;
  teams: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  /** TBA's overall status sentence, e.g. "Team 254 was Winner …". */
  playoff: string | null;
};

export type DossierStats = {
  normEpa: number | null;
  record: { wins: number; losses: number; ties: number; winrate: number } | null;
  years: Array<{
    year: number;
    epa: number | null;
    rankWorld: number | null;
    teamsWorld: number | null;
    rankCountry: number | null;
    rankState: number | null;
    rankDistrict: number | null;
  }>;
};

export type DossierSources = {
  tba: { ok: boolean; at: string; error?: string };
  statbotics: { ok: boolean; at: string; error?: string };
};

export type TeamDossierPayload = {
  teamNumber: number;
  profile: DossierProfile | null;
  yearsParticipated: number[];
  awards: DossierAward[];
  events: DossierEvent[];
  stats: DossierStats | null;
  sources: DossierSources;
};

type TbaTeam = {
  nickname?: string | null;
  name?: string | null;
  city?: string | null;
  state_prov?: string | null;
  country?: string | null;
  rookie_year?: number | null;
  website?: string | null;
  school_name?: string | null;
};
type TbaAward = { name?: string; event_key?: string; year?: number };
type TbaEventSimple = { key: string; name?: string; week?: number | null; year?: number };
type TbaEventStatus = {
  qual?: { num_teams?: number; ranking?: { rank?: number; record?: { wins?: number; losses?: number; ties?: number } } } | null;
  overall_status_str?: string | null;
} | null;

type SbTeam = {
  norm_epa?: { current?: number | null } | number | null;
  record?: { wins?: number; losses?: number; ties?: number; winrate?: number } | null;
};
type SbTeamYear = {
  year?: number;
  epa?: {
    total_points?: { mean?: number | null } | null;
    norm?: number | null;
    ranks?: {
      total?: { rank?: number | null; team_count?: number | null } | null;
      country?: { rank?: number | null } | null;
      state?: { rank?: number | null } | null;
      district?: { rank?: number | null } | null;
    } | null;
  } | null;
};

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function buildTeamDossier(input: {
  teamNumber: number;
  tba: TbaGetter;
  statbotics: Pick<StatboticsClient, "get">;
  now?: () => Date;
  /** How many recent seasons to pull event results for. Default 2. */
  recentSeasons?: number;
}): Promise<TeamDossierPayload> {
  const now = input.now ?? (() => new Date());
  const key = `frc${input.teamNumber}`;
  const at = () => now().toISOString();

  let profile: DossierProfile | null = null;
  let yearsParticipated: number[] = [];
  let awards: DossierAward[] = [];
  const events: DossierEvent[] = [];
  let tbaSource: DossierSources["tba"];

  try {
    const [team, years, awardRows] = await Promise.all([
      tbaData<TbaTeam>(input.tba, `/team/${key}`),
      tbaData<number[]>(input.tba, `/team/${key}/years_participated`),
      tbaData<TbaAward[]>(input.tba, `/team/${key}/awards`),
    ]);
    profile = team
      ? {
          nickname: str(team.nickname),
          name: str(team.name),
          city: str(team.city),
          stateProv: str(team.state_prov),
          country: str(team.country),
          rookieYear: num(team.rookie_year),
          website: str(team.website),
          schoolName: str(team.school_name),
        }
      : null;
    yearsParticipated = Array.isArray(years) ? years.map(num).filter((y): y is number => y != null).sort((a, b) => a - b) : [];

    // Recent seasons: the last N the team actually attended, not the last N
    // calendar years — a team that skipped 2021 should not show an empty 2021.
    const recent = yearsParticipated.slice(-(input.recentSeasons ?? 2));
    const eventNames = new Map<string, string>();
    for (const year of recent) {
      const [simple, statuses] = await Promise.all([
        tbaData<TbaEventSimple[]>(input.tba, `/team/${key}/events/${year}/simple`),
        tbaData<Record<string, TbaEventStatus>>(input.tba, `/team/${key}/events/${year}/statuses`),
      ]);
      for (const ev of simple ?? []) {
        if (ev.name) eventNames.set(ev.key, ev.name);
        const st = statuses?.[ev.key] ?? null;
        const rec = st?.qual?.ranking?.record;
        events.push({
          year,
          eventKey: ev.key,
          name: str(ev.name),
          week: num(ev.week) == null ? null : num(ev.week)! + 1, // TBA weeks are zero-based
          rank: num(st?.qual?.ranking?.rank),
          teams: num(st?.qual?.num_teams),
          wins: num(rec?.wins),
          losses: num(rec?.losses),
          ties: num(rec?.ties),
          playoff: str(st?.overall_status_str),
        });
      }
    }
    events.sort((a, b) => b.year - a.year || (a.week ?? 99) - (b.week ?? 99));

    awards = (Array.isArray(awardRows) ? awardRows : [])
      .map((a) => ({
        year: num(a.year) ?? 0,
        eventKey: str(a.event_key) ?? "",
        eventName: eventNames.get(str(a.event_key) ?? "") ?? null,
        name: str(a.name) ?? "",
      }))
      .filter((a) => a.name && a.year > 0)
      .sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));

    tbaSource = { ok: true, at: at() };
  } catch (error) {
    tbaSource = { ok: false, at: at(), error: error instanceof Error ? error.message : "TBA request failed" };
  }

  let stats: DossierStats | null = null;
  let sbSource: DossierSources["statbotics"];
  try {
    const [team, years] = await Promise.all([
      input.statbotics.get<SbTeam>(`/team/${input.teamNumber}`),
      input.statbotics.get<SbTeamYear[]>(`/team_years?team=${input.teamNumber}&limit=50`),
    ]);
    const normEpa =
      team?.norm_epa == null
        ? null
        : typeof team.norm_epa === "number"
          ? num(team.norm_epa)
          : num(team.norm_epa.current);
    const rec = team?.record;
    stats = {
      normEpa,
      record:
        rec && num(rec.wins) != null && num(rec.losses) != null
          ? {
              wins: num(rec.wins)!,
              losses: num(rec.losses)!,
              ties: num(rec.ties) ?? 0,
              winrate: num(rec.winrate) ?? 0,
            }
          : null,
      years: (Array.isArray(years) ? years : [])
        .map((y) => ({
          year: num(y.year) ?? 0,
          epa: num(y.epa?.total_points?.mean) ?? num(y.epa?.norm),
          rankWorld: num(y.epa?.ranks?.total?.rank),
          teamsWorld: num(y.epa?.ranks?.total?.team_count),
          rankCountry: num(y.epa?.ranks?.country?.rank),
          rankState: num(y.epa?.ranks?.state?.rank),
          rankDistrict: num(y.epa?.ranks?.district?.rank),
        }))
        .filter((y) => y.year > 0)
        .sort((a, b) => b.year - a.year),
    };
    sbSource = { ok: true, at: at() };
  } catch (error) {
    sbSource = { ok: false, at: at(), error: error instanceof Error ? error.message : "Statbotics request failed" };
  }

  return {
    teamNumber: input.teamNumber,
    profile,
    yearsParticipated,
    awards,
    events,
    stats,
    sources: { tba: tbaSource, statbotics: sbSource },
  };
}

async function tbaData<T>(tba: TbaGetter, resource: string): Promise<T | null> {
  const response = await tba.get<T>(resource);
  // 304 cannot happen without a conditional header, but the type admits it.
  return response.status === 200 ? response.data : null;
}

/** Seasons a team has competed, from years_participated. 0 when unknown. */
export function seasonsCompeted(years: readonly number[]): number {
  return new Set(years.filter((y) => Number.isFinite(y))).size;
}
