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

  /**
   * Every team at an event, best-rated first, with how many of our own scout
   * rows each has — the list a strategist opens the lookup to scan. Teams come
   * from the schedule and from synced ratings, so a roster exists before the
   * schedule is posted. Rating stays null when none is synced.
   */
  async eventRoster(orgId: string, eventKey: string, limit = 80) {
    const result = await this.client.query<{
      teamKey: string;
      teamNumber: number;
      nickname: string | null;
      epaTotal: number | null;
      scouted: number;
      pitScouted: number;
    }>(
      `WITH roster AS (
         SELECT jsonb_array_elements_text(m.red_alliance->'teamKeys') AS team_key
           FROM matches_ref m WHERE m.event_key = $2::text
         UNION
         SELECT jsonb_array_elements_text(m.blue_alliance->'teamKeys')
           FROM matches_ref m WHERE m.event_key = $2::text
         UNION
         SELECT tm.team_key FROM team_event_metrics tm WHERE tm.event_key = $2::text
       ),
       rating AS (
         SELECT DISTINCT ON (tm.team_key) tm.team_key, tm.epa_total
           FROM team_event_metrics tm
          WHERE tm.event_key = $2::text
          ORDER BY tm.team_key,
            CASE tm.source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
            tm.synced_at DESC NULLS LAST
       ),
       scouted AS (
         SELECT s.team_key, count(*)::int AS n
           FROM match_scout_entries s
          WHERE s.org_id = $1::uuid AND s.event_key = $2::text
          GROUP BY s.team_key
       ),
       pit AS (
         SELECT p.team_key, count(*)::int AS n
           FROM pit_scout_entries p
          WHERE p.org_id = $1::uuid AND p.event_key = $2::text
          GROUP BY p.team_key
       )
       SELECT r.team_key AS "teamKey",
              COALESCE(t.team_number, NULLIF(regexp_replace(r.team_key, '\\D', '', 'g'), '')::int) AS "teamNumber",
              t.nickname,
              rating.epa_total::float8 AS "epaTotal",
              COALESCE(scouted.n, 0) AS scouted,
              COALESCE(pit.n, 0) AS "pitScouted"
         FROM roster r
         LEFT JOIN teams_ref t ON t.team_key = r.team_key
         LEFT JOIN rating ON rating.team_key = r.team_key
         LEFT JOIN scouted ON scouted.team_key = r.team_key
         LEFT JOIN pit ON pit.team_key = r.team_key
        ORDER BY rating.epa_total DESC NULLS LAST, 2
        LIMIT $3`,
      [orgId, eventKey, Math.min(Math.max(limit, 1), 120)],
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

  async getActiveEvent(orgId: string): Promise<{ eventKey: string; eventName: string | null } | null> {
    const result = await this.client.query<{ eventKey: string; eventName: string | null }>(
      `SELECT c.active_event_key AS "eventKey", e.name AS "eventName"
       FROM org_active_context c
       LEFT JOIN events_ref e ON e.event_key = c.active_event_key
       WHERE c.org_id = $1 AND c.active_event_key IS NOT NULL`,
      [orgId],
    );
    const row = result.rows[0];
    if (!row?.eventKey) return null;
    return { eventKey: row.eventKey, eventName: row.eventName };
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
