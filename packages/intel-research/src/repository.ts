import type { PoolClient } from "@neondatabase/serverless";
import { deriveFoulRisk, deriveReliability, historicalTrajectory, robotArchetypes } from "./analytics";
import type { Finding, Metric, ScoutObservation, TeamIntel } from "./types";

type TeamRow = TeamIntel["team"] & { atActiveEvent: boolean };

export class IntelResearchRepository {
  constructor(private readonly client: PoolClient) {}

  async searchTeams(orgId: string, query: string, limit = 20) {
    const result = await this.client.query<TeamRow>(
      `WITH active AS (
         SELECT active_event_key FROM org_active_context WHERE org_id = $1
       )
       SELECT t.team_key AS "teamKey", t.team_number AS "teamNumber", t.nickname,
         t.name, t.city, t.state_prov AS "stateProv", t.country,
         t.rookie_year AS "rookieYear",
         EXISTS (
           SELECT 1 FROM matches_ref m, active a
           WHERE m.event_key = a.active_event_key
             AND ((m.red_alliance->'teamKeys') ? t.team_key OR (m.blue_alliance->'teamKeys') ? t.team_key)
         ) AS "atActiveEvent"
       FROM teams_ref t
       WHERE t.team_number::text = $2 OR t.nickname ILIKE $3 OR t.name ILIKE $3
       ORDER BY "atActiveEvent" DESC,
         CASE WHEN t.team_number::text = $2 THEN 0 ELSE 1 END, t.team_number
       LIMIT $4`,
      [orgId, query.trim(), `%${query.trim()}%`, Math.min(Math.max(limit, 1), 50)],
    );
    return result.rows;
  }

  async getTeamIntel(orgId: string, teamNumber: number): Promise<TeamIntel | null> {
    const teamResult = await this.client.query<TeamRow>(
      `SELECT t.team_key AS "teamKey", t.team_number AS "teamNumber", t.nickname,
        t.name, t.city, t.state_prov AS "stateProv", t.country,
        t.rookie_year AS "rookieYear",
        EXISTS (
          SELECT 1 FROM org_active_context c JOIN matches_ref m ON m.event_key=c.active_event_key
          WHERE c.org_id=$1 AND ((m.red_alliance->'teamKeys') ? t.team_key OR (m.blue_alliance->'teamKeys') ? t.team_key)
        ) AS "atActiveEvent"
       FROM teams_ref t WHERE t.team_number=$2`,
      [orgId, teamNumber],
    );
    const row = teamResult.rows[0];
    if (!row) return null;
    const [metrics, findings, scoutObservations] = await Promise.all([
      this.getMetrics(row.teamKey),
      this.getFindings(row.teamKey),
      this.getScoutObservations(orgId, row.teamKey),
    ]);
    return {
      team: {
        teamKey: row.teamKey,
        teamNumber: row.teamNumber,
        nickname: row.nickname,
        name: row.name,
        city: row.city,
        stateProv: row.stateProv,
        country: row.country,
        rookieYear: row.rookieYear,
      },
      atActiveEvent: row.atActiveEvent,
      metrics,
      findings,
      trajectory: historicalTrajectory(metrics),
      archetypes: robotArchetypes(metrics, scoutObservations),
      reliability: deriveReliability(scoutObservations),
      foulRisk: deriveFoulRisk(scoutObservations),
    };
  }

  async getMetrics(teamKey: string): Promise<Metric[]> {
    const result = await this.client.query<Metric>(
      `SELECT m.event_key AS "eventKey", e.year, m.epa_total AS "epaTotal",
        m.epa_auto AS "epaAuto", m.epa_teleop AS "epaTeleop",
        m.epa_endgame AS "epaEndgame", m.opr, m.dpr, m.rank, m.wins,
        m.losses, m.ties, m.source
       FROM team_event_metrics m JOIN events_ref e ON e.event_key=m.event_key
       WHERE m.team_key=$1
       UNION ALL
       SELECT NULL, y.year, y.epa_total, y.epa_auto, y.epa_teleop,
        y.epa_endgame, NULL, NULL, NULL, NULL, NULL, NULL, y.source
       FROM team_year_metrics y WHERE y.team_key=$1
       ORDER BY year DESC`,
      [teamKey],
    );
    return result.rows;
  }

  async getFindings(teamKey: string): Promise<Finding[]> {
    const result = await this.client.query<Finding>(
      `SELECT id, source_url AS "sourceUrl", source_title AS "sourceTitle",
        source_type AS "sourceType", summary, confidence,
        published_at AS "publishedAt", found_at AS "foundAt",
        extracted_facts AS "extractedFacts"
       FROM research_findings WHERE team_key=$1
       ORDER BY found_at DESC LIMIT 30`,
      [teamKey],
    );
    return result.rows;
  }

  async getSimilarTeams(teamKey: string, limit = 5) {
    const result = await this.client.query(
      `WITH target AS (
         SELECT epa_total FROM team_year_metrics WHERE team_key=$1 AND epa_total IS NOT NULL
         ORDER BY year DESC LIMIT 1
       ), latest AS (
         SELECT DISTINCT ON (m.team_key) m.team_key,m.epa_total
         FROM team_year_metrics m WHERE m.epa_total IS NOT NULL
         ORDER BY m.team_key,m.year DESC
       )
       SELECT t.team_key AS "teamKey",t.team_number AS "teamNumber",t.nickname,
         l.epa_total AS "epaTotal",abs(l.epa_total-target.epa_total) AS distance
       FROM latest l JOIN teams_ref t ON t.team_key=l.team_key CROSS JOIN target
       WHERE l.team_key<>$1 ORDER BY distance,t.team_number LIMIT $2`,
      [teamKey, Math.min(Math.max(limit, 1), 10)],
    );
    return result.rows;
  }

  async getScoutObservations(orgId: string, teamKey: string): Promise<ScoutObservation[]> {
    const result = await this.client.query<ScoutObservation>(
      `SELECT payload, confidence, match_key AS "matchKey" FROM match_scout_entries
       WHERE org_id=$1 AND team_key=$2 AND confidence <> 'low'
       UNION ALL
       SELECT payload, confidence, NULL FROM pit_scout_entries
       WHERE org_id=$1 AND team_key=$2 AND confidence <> 'low'`,
      [orgId, teamKey],
    );
    return result.rows;
  }

  async queueOnDemand(orgId: string, userId: string, teamKey: string) {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO research_jobs(org_id,requested_by,team_key,trigger,status)
       VALUES($1,$2,$3,'on_demand','queued') RETURNING id`,
      [orgId, userId, teamKey],
    );
    return result.rows[0]!.id;
  }

  async listPickLists(orgId: string, eventKey?: string) {
    const result = await this.client.query(
      `SELECT l.id,l.event_key AS "eventKey",l.name,l.updated_at AS "updatedAt",
        COALESCE(json_agg(json_build_object(
          'id',e.id,'teamKey',e.team_key,'teamNumber',t.team_number,
          'nickname',t.nickname,'rank',e.rank,'tier',e.tier,'notes',e.notes
        ) ORDER BY e.rank) FILTER (WHERE e.id IS NOT NULL),'[]') AS entries
       FROM pick_lists l LEFT JOIN pick_list_entries e ON e.pick_list_id=l.id
       LEFT JOIN teams_ref t ON t.team_key=e.team_key
       WHERE l.org_id=$1 AND ($2::text IS NULL OR l.event_key=$2)
       GROUP BY l.id ORDER BY l.updated_at DESC`,
      [orgId, eventKey ?? null],
    );
    return result.rows;
  }

  async savePickList(
    orgId: string,
    userId: string,
    input: {
      id?: string;
      eventKey: string;
      name: string;
      entries: Array<{ teamKey: string; rank: number; tier?: string; notes?: string }>;
    },
  ) {
    const list = await this.client.query<{ id: string }>(
      `INSERT INTO pick_lists(id,org_id,event_key,name,created_by)
       VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=now()
       RETURNING id`,
      [input.id ?? null, orgId, input.eventKey, input.name.trim(), userId],
    );
    const id = list.rows[0]!.id;
    await this.client.query("DELETE FROM pick_list_entries WHERE pick_list_id=$1", [id]);
    for (const entry of input.entries) {
      await this.client.query(
        `INSERT INTO pick_list_entries(pick_list_id,org_id,team_key,rank,tier,notes)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [id, orgId, entry.teamKey, entry.rank, entry.tier ?? null, entry.notes ?? null],
      );
    }
    return id;
  }
}
