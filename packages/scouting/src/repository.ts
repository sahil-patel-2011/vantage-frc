import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import {
  detectDisagreements,
  validatePayload,
  type ScoutSchema,
  type SyncEntry,
} from "./index";

type StoredEntry = {
  id: string;
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
};

export class ScoutingRepository {
  constructor(private readonly client: PoolClient) {}

  async bootstrap(orgId: string, userId: string) {
    const context = await this.client.query<{ activeEventKey: string | null }>(
      `SELECT active_event_key AS "activeEventKey"
       FROM org_active_context WHERE org_id = $1`,
      [orgId],
    );
    const eventKey = context.rows[0]?.activeEventKey ?? null;
    if (!eventKey) {
      return { eventKey: null, schemas: [], assignments: [], matches: [], recentEntries: [] };
    }
    const [schemas, assignments, matches, recentEntries] = await Promise.all([
      this.client.query(
        `SELECT DISTINCT ON (type) id, org_id AS "orgId", year, type, version,
          schema AS definition FROM scout_schemas
         WHERE org_id = $1 AND year = (SELECT year FROM events_ref WHERE event_key = $2)
         ORDER BY type, version DESC`,
        [orgId, eventKey],
      ),
      this.client.query(
        `SELECT a.id, a.event_key AS "eventKey", a.match_key AS "matchKey",
          a.team_key AS "teamKey", a.role, a.starts_at AS "startsAt",
          m.comp_level AS "compLevel", m.match_number AS "matchNumber"
         FROM scout_assignments a JOIN matches_ref m ON m.match_key = a.match_key
         WHERE a.org_id = $1 AND a.user_id = $2 AND a.event_key = $3
         ORDER BY m.event_time NULLS LAST, m.match_number`,
        [orgId, userId, eventKey],
      ),
      this.client.query(
        `SELECT match_key AS "matchKey", comp_level AS "compLevel",
          match_number AS "matchNumber", red_alliance AS "redAlliance",
          blue_alliance AS "blueAlliance", event_time AS "eventTime"
         FROM matches_ref WHERE event_key = $1
         ORDER BY event_time NULLS LAST, match_number`,
        [eventKey],
      ),
      this.client.query(
        `SELECT e.id,'match' AS type,e.match_key AS "matchKey",e.team_key AS "teamKey",
          e.confidence,e.source,e.updated_at AS "updatedAt",u.name AS "scoutName"
         FROM match_scout_entries e JOIN users u ON u.id=e.scout_user_id
         WHERE e.org_id=$1 AND e.event_key=$2
         UNION ALL
         SELECT e.id,'pit' AS type,NULL,e.team_key,e.confidence,e.source,
          e.updated_at,u.name
         FROM pit_scout_entries e JOIN users u ON u.id=e.scout_user_id
         WHERE e.org_id=$1 AND e.event_key=$2
         ORDER BY "updatedAt" DESC LIMIT 30`,
        [orgId, eventKey],
      ),
    ]);
    return {
      eventKey,
      schemas: schemas.rows,
      assignments: assignments.rows,
      matches: matches.rows,
      recentEntries: recentEntries.rows,
    };
  }

  async getSchema(orgId: string, schemaId: string): Promise<ScoutSchema> {
    const result = await this.client.query<ScoutSchema>(
      `SELECT id, org_id AS "orgId", year, type, version, schema AS definition
       FROM scout_schemas WHERE id = $1 AND org_id = $2`,
      [schemaId, orgId],
    );
    const schema = result.rows[0];
    if (!schema) throw new Error("Pinned scouting schema not found");
    return schema;
  }

  async syncEntry(orgId: string, userId: string, input: SyncEntry) {
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const receipt = await this.client.query<{
      serverEntryId: string;
      payloadHash: string;
    }>(
      `SELECT server_entry_id AS "serverEntryId", payload_hash AS "payloadHash"
       FROM scout_sync_receipts WHERE org_id = $1 AND client_id = $2`,
      [orgId, input.clientId],
    );
    const existing = receipt.rows[0];
    if (existing) {
      if (existing.payloadHash === hash) {
        return { clientId: input.clientId, entryId: existing.serverEntryId, duplicate: true };
      }
      const schema = await this.getSchema(orgId, input.schemaId);
      if (schema.type !== input.type) throw new Error("Schema type does not match entry type");
      const validationErrors = validatePayload(schema.definition, input.payload);
      if (validationErrors.length) throw new Error(validationErrors.join("; "));
      const table = input.type === "match" ? "match_scout_entries" : "pit_scout_entries";
      const update = await this.client.query(
        `UPDATE ${table} SET payload=$1::jsonb,confidence=$2,source=$3,
          schema_id=$4,updated_at=$5::timestamptz,synced_at=now()
         WHERE id=$6 AND org_id=$7 AND scout_user_id=$8
           AND updated_at <= $5::timestamptz
         RETURNING id`,
        [
          JSON.stringify(input.payload), input.confidence, input.source,
          input.schemaId, input.updatedAt, existing.serverEntryId, orgId, userId,
        ],
      );
      if (update.rowCount) {
        await this.client.query(
          `UPDATE scout_sync_receipts SET payload_hash=$1,acknowledged_at=now()
           WHERE org_id=$2 AND client_id=$3`,
          [hash, orgId, input.clientId],
        );
        if (input.type === "match") await this.refreshDisagreements(orgId, input, schema);
      }
      return {
        clientId: input.clientId,
        entryId: existing.serverEntryId,
        duplicate: !update.rowCount,
      };
    }

    const schema = await this.getSchema(orgId, input.schemaId);
    if (schema.type !== input.type) throw new Error("Schema type does not match entry type");
    const validationErrors = validatePayload(schema.definition, input.payload);
    if (validationErrors.length) throw new Error(validationErrors.join("; "));
    if (input.type === "match" && !input.matchKey) throw new Error("Match key is required");

    const entryId = randomUUID();
    const table = input.type === "match" ? "match_scout_entries" : "pit_scout_entries";
    if (input.type === "match") {
      await this.client.query(
        `INSERT INTO match_scout_entries
          (id, org_id, event_key, match_key, team_key, scout_user_id, schema_id,
           payload, confidence, source, client_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::timestamptz)`,
        [
          entryId, orgId, input.eventKey, input.matchKey, input.teamKey, userId,
          input.schemaId, JSON.stringify(input.payload), input.confidence,
          input.source, input.clientId, input.updatedAt,
        ],
      );
    } else {
      await this.client.query(
        `INSERT INTO pit_scout_entries
          (id, org_id, event_key, team_key, scout_user_id, schema_id,
           payload, confidence, source, client_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::timestamptz)`,
        [
          entryId, orgId, input.eventKey, input.teamKey, userId, input.schemaId,
          JSON.stringify(input.payload), input.confidence, input.source,
          input.clientId, input.updatedAt,
        ],
      );
    }
    await this.client.query(
      `INSERT INTO scout_sync_receipts
        (org_id, client_id, entry_type, server_entry_id, payload_hash)
       VALUES ($1,$2,$3,$4,$5)`,
      [orgId, input.clientId, input.type, entryId, hash],
    );
    if (input.type === "match") {
      await this.refreshDisagreements(orgId, input, schema);
    }
    return { clientId: input.clientId, entryId, duplicate: false, table };
  }

  private async refreshDisagreements(
    orgId: string,
    input: SyncEntry,
    schema: ScoutSchema,
  ) {
    const entries = await this.client.query<StoredEntry>(
      `SELECT id, payload, confidence FROM match_scout_entries
       WHERE org_id = $1 AND match_key = $2 AND team_key = $3 AND schema_id = $4`,
      [orgId, input.matchKey, input.teamKey, input.schemaId],
    );
    for (const conflict of detectDisagreements(schema.definition, entries.rows)) {
      await this.client.query(
        `INSERT INTO scout_disagreements
          (org_id,event_key,match_key,team_key,field_key,entry_ids,values)
         VALUES ($1,$2,$3,$4,$5,$6::uuid[],$7::jsonb)
         ON CONFLICT (org_id,match_key,team_key,field_key) DO UPDATE SET
          entry_ids=excluded.entry_ids, values=excluded.values, status='open',
          resolution=NULL, reviewed_by=NULL, reviewed_at=NULL, updated_at=now()`,
        [
          orgId, input.eventKey, input.matchKey, input.teamKey,
          conflict.fieldKey, conflict.entryIds, JSON.stringify(conflict.values),
        ],
      );
    }
  }
}
