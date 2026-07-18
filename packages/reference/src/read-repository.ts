import type { PoolClient } from "@neondatabase/serverless";
import type {
  EventRecord,
  MatchRecord,
  TeamEventMetricRecord,
  TeamRecord,
  TeamYearMetricRecord,
} from "./types";

export type TeamReference = TeamRecord & {
  eventMetrics: TeamEventMetricRecord[];
  yearMetrics: TeamYearMetricRecord[];
};

/**
 * Authenticated request repository. Pass only the client supplied by withRls()
 * so reference-table RLS is evaluated with the request's app.user_id.
 */
export class ReferenceReadRepository {
  constructor(private readonly client: PoolClient) {}

  async findTeamByNumber(
    teamNumber: number,
    year?: number,
  ): Promise<TeamReference | null> {
    const teamResult = await this.client.query(
      `SELECT team_key AS "teamKey", team_number AS "teamNumber", nickname, name, city,
        state_prov AS "stateProv", country, postal_code AS "postalCode",
        rookie_year AS "rookieYear", website, synced_at AS "syncedAt"
       FROM teams_ref WHERE team_number = $1`,
      [teamNumber],
    );
    const team = teamResult.rows[0] as TeamRecord | undefined;
    if (!team) return null;
    const [eventMetrics, yearMetrics] = await Promise.all([
      this.getTeamEventMetrics(team.teamKey, year),
      this.getTeamYearMetrics(team.teamKey, year),
    ]);
    return { ...team, eventMetrics, yearMetrics };
  }

  async searchTeams(query: string, limit = 20): Promise<TeamRecord[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const result = await this.client.query(
      `SELECT team_key AS "teamKey", team_number AS "teamNumber", nickname, name, city,
        state_prov AS "stateProv", country, postal_code AS "postalCode",
        rookie_year AS "rookieYear", website, synced_at AS "syncedAt"
       FROM teams_ref
       WHERE team_number::text = $1 OR nickname ILIKE $2 OR name ILIKE $2
       ORDER BY CASE WHEN team_number::text = $1 THEN 0 ELSE 1 END, team_number
       LIMIT $3`,
      [query.trim(), `%${query.trim()}%`, boundedLimit],
    );
    return result.rows as TeamRecord[];
  }

  async getEvent(eventKey: string): Promise<EventRecord | null> {
    const result = await this.client.query(
      `SELECT event_key AS "eventKey", year, name, short_name AS "shortName",
        start_date AS "startDate", end_date AS "endDate", event_type AS "eventType",
        week, district_key AS "districtKey", city, state_prov AS "stateProv", country,
        address, postal_code AS "postalCode", timezone, website,
        parent_event_key AS "parentEventKey", webcasts, synced_at AS "syncedAt"
       FROM events_ref WHERE event_key = $1`,
      [eventKey],
    );
    return (result.rows[0] as EventRecord | undefined) ?? null;
  }

  async listEventMatches(eventKey: string): Promise<MatchRecord[]> {
    const result = await this.client.query(
      `SELECT match_key AS "matchKey", event_key AS "eventKey", comp_level AS "compLevel",
        set_number AS "setNumber", match_number AS "matchNumber",
        red_alliance AS "redAlliance", blue_alliance AS "blueAlliance",
        winning_alliance AS "winningAlliance", event_time AS "eventTime",
        predicted_time AS "predictedTime", actual_time AS "actualTime",
        post_result_time AS "postResultTime", score_breakdown AS "scoreBreakdown",
        videos, synced_at AS "syncedAt"
       FROM matches_ref WHERE event_key = $1
       ORDER BY CASE comp_level
         WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
         WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5 END,
         set_number, match_number`,
      [eventKey],
    );
    return result.rows as MatchRecord[];
  }

  async getMatch(matchKey: string): Promise<MatchRecord | null> {
    const result = await this.client.query(
      `SELECT match_key AS "matchKey", event_key AS "eventKey", comp_level AS "compLevel",
        set_number AS "setNumber", match_number AS "matchNumber",
        red_alliance AS "redAlliance", blue_alliance AS "blueAlliance",
        winning_alliance AS "winningAlliance", event_time AS "eventTime",
        predicted_time AS "predictedTime", actual_time AS "actualTime",
        post_result_time AS "postResultTime", score_breakdown AS "scoreBreakdown",
        videos, synced_at AS "syncedAt"
       FROM matches_ref WHERE match_key = $1`,
      [matchKey],
    );
    return (result.rows[0] as MatchRecord | undefined) ?? null;
  }

  /** Cached match snapshot for live scout ↔ TBA cross-validation. */
  async getMatchOfficialSnapshot(matchKey: string, eventKey?: string): Promise<MatchRecord | null> {
    const result = await this.client.query(
      `SELECT match_key AS "matchKey", event_key AS "eventKey", comp_level AS "compLevel",
        set_number AS "setNumber", match_number AS "matchNumber",
        red_alliance AS "redAlliance", blue_alliance AS "blueAlliance",
        winning_alliance AS "winningAlliance", event_time AS "eventTime",
        predicted_time AS "predictedTime", actual_time AS "actualTime",
        post_result_time AS "postResultTime", score_breakdown AS "scoreBreakdown",
        videos, synced_at AS "syncedAt"
       FROM matches_ref
       WHERE match_key = $1 AND ($2::text IS NULL OR event_key = $2)`,
      [matchKey, eventKey ?? null],
    );
    return (result.rows[0] as MatchRecord | undefined) ?? null;
  }

  async getTeamEventEpaEndgame(teamKey: string, eventKey: string): Promise<number | null> {
    const result = await this.client.query<{ epaEndgame: number | null }>(
      `SELECT epa_endgame AS "epaEndgame"
       FROM team_event_metrics
       WHERE team_key = $1 AND event_key = $2 AND source = 'statbotics'
       ORDER BY synced_at DESC NULLS LAST
       LIMIT 1`,
      [teamKey, eventKey],
    );
    const value = result.rows[0]?.epaEndgame;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private async getTeamEventMetrics(
    teamKey: string,
    year?: number,
  ): Promise<TeamEventMetricRecord[]> {
    const result = await this.client.query(
      `SELECT m.team_key AS "teamKey", m.event_key AS "eventKey",
        m.epa_total AS "epaTotal", m.epa_auto AS "epaAuto",
        m.epa_teleop AS "epaTeleop", m.epa_endgame AS "epaEndgame",
        m.opr, m.dpr, m.ccwm, m.rank, m.wins, m.losses, m.ties,
        m.source, m.source_payload AS "sourcePayload", m.synced_at AS "syncedAt"
       FROM team_event_metrics m
       JOIN events_ref e ON e.event_key = m.event_key
       WHERE m.team_key = $1 AND ($2::integer IS NULL OR e.year = $2)
       ORDER BY e.start_date DESC NULLS LAST, m.source`,
      [teamKey, year ?? null],
    );
    return result.rows as TeamEventMetricRecord[];
  }

  private async getTeamYearMetrics(
    teamKey: string,
    year?: number,
  ): Promise<TeamYearMetricRecord[]> {
    const result = await this.client.query(
      `SELECT team_key AS "teamKey", year, epa_total AS "epaTotal",
        epa_auto AS "epaAuto", epa_teleop AS "epaTeleop",
        epa_endgame AS "epaEndgame", source,
        source_payload AS "sourcePayload", synced_at AS "syncedAt"
       FROM team_year_metrics
       WHERE team_key = $1 AND ($2::integer IS NULL OR year = $2)
       ORDER BY year DESC, source`,
      [teamKey, year ?? null],
    );
    return result.rows as TeamYearMetricRecord[];
  }
}
