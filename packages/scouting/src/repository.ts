import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import {
  DEFAULT_MATCH_SCHEMA,
  DEFAULT_PIT_SCHEMA,
  detectDisagreements,
  validatePayload,
  type EntryType,
  type ScoutSchema,
  type SyncEntry,
} from "./index";
import { bindScoutIdentity, lockScoutPayload, stripScoutIdentityFields } from "./identity"; // CD4_IDENTITY_LOCK
import { crossValidateScoutPayload, type FieldValidation } from "./trust";

type StoredEntry = {
  id: string;
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
};

export type SyncAcknowledgement = {
  clientId: string;
  entryId: string;
  duplicate: boolean;
  table?: string;
  validations: FieldValidation[];
};

export class ScoutingRepository {
  constructor(private readonly client: PoolClient) {}

  async bootstrap(orgId: string, userId: string) {
    const membership = await this.client.query<{ role: string }>(
      `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
    const role = membership.rows[0]?.role ?? "viewer";
    const canManageSchemas = role === "owner" || role === "admin";

    const context = await this.client.query<{ activeEventKey: string | null }>(
      `SELECT active_event_key AS "activeEventKey"
       FROM org_active_context WHERE org_id = $1`,
      [orgId],
    );
    const eventKey = context.rows[0]?.activeEventKey ?? null;
    const profile = await this.client.query<{
      name: string | null;
      email: string | null;
      displayName: string | null;
    }>(
      `SELECT u.name, u.email, p.display_name AS "displayName"
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    const scoutIdentity = bindScoutIdentity({
      userId,
      displayName: profile.rows[0]?.displayName || profile.rows[0]?.name,
      email: profile.rows[0]?.email,
    });
    if (!eventKey) {
      return {
        eventKey: null,
        schemas: [],
        assignments: [],
        matches: [],
        recentEntries: [],
        canManageSchemas,
        scoutIdentity,
      };
    }

    if (canManageSchemas) {
      await this.ensureDefaultSchemas(orgId, userId, eventKey);
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
          e.confidence,e.source,e.updated_at AS "updatedAt",
          e.scout_user_id AS "scoutUserId",u.name AS "scoutName"
         FROM match_scout_entries e JOIN users u ON u.id=e.scout_user_id
         WHERE e.org_id=$1 AND e.event_key=$2
         UNION ALL
         SELECT e.id,'pit' AS type,NULL,e.team_key,e.confidence,e.source,
          e.updated_at,e.scout_user_id,u.name
         FROM pit_scout_entries e JOIN users u ON u.id=e.scout_user_id
         WHERE e.org_id=$1 AND e.event_key=$2
         ORDER BY "updatedAt" DESC LIMIT 30`,
        [orgId, eventKey],
      ),
    ]);
    return {
      eventKey,
      schemas: schemas.rows.map((row) => ({
        ...row,
        definition: stripScoutIdentityFields(
          (row as { definition: Parameters<typeof stripScoutIdentityFields>[0] }).definition,
        ).definition,
      })),
      assignments: assignments.rows,
      matches: matches.rows,
      recentEntries: recentEntries.rows,
      canManageSchemas,
      scoutIdentity,
    };
  }

  async ensureDefaultSchemas(orgId: string, userId: string, eventKey: string) {
    const yearRow = await this.client.query<{ year: number }>(
      `SELECT year FROM events_ref WHERE event_key = $1`,
      [eventKey],
    );
    const year = yearRow.rows[0]?.year;
    if (!year) return;

    for (const entry of [
      { type: "match" as EntryType, definition: DEFAULT_MATCH_SCHEMA },
      { type: "pit" as EntryType, definition: DEFAULT_PIT_SCHEMA },
    ]) {
      const existing = await this.client.query(
        `SELECT 1 FROM scout_schemas WHERE org_id = $1 AND year = $2 AND type = $3 LIMIT 1`,
        [orgId, year, entry.type],
      );
      if (existing.rowCount) continue;
      await this.client.query(
        `INSERT INTO scout_schemas (org_id, year, type, version, schema, created_by)
         VALUES ($1, $2, $3, 1, $4::jsonb, $5)`,
        [orgId, year, entry.type, JSON.stringify(entry.definition), userId],
      );
    }
  }

  async getSchema(orgId: string, schemaId: string): Promise<ScoutSchema> {
    const result = await this.client.query<ScoutSchema>(
      `SELECT id, org_id AS "orgId", year, type, version, schema AS definition
       FROM scout_schemas WHERE id = $1 AND org_id = $2`,
      [schemaId, orgId],
    );
    const schema = result.rows[0];
    if (!schema) throw new Error("Pinned scouting schema not found");
    return {
      ...schema,
      definition: stripScoutIdentityFields(schema.definition).definition,
    };
  }

  async syncEntry(orgId: string, userId: string, input: SyncEntry): Promise<SyncAcknowledgement> {
    const locked: SyncEntry = { ...input, payload: lockScoutPayload(input.payload).payload };
    const hash = createHash("sha256")
      .update(JSON.stringify(locked))
      .digest("hex");
    const receipt = await this.client.query<{
      serverEntryId: string;
      payloadHash: string;
    }>(
      `SELECT server_entry_id AS "serverEntryId", payload_hash AS "payloadHash"
       FROM scout_sync_receipts WHERE org_id = $1 AND client_id = $2`,
      [orgId, locked.clientId],
    );
    const existing = receipt.rows[0];
    if (existing) {
      if (existing.payloadHash === hash) {
        return {
          clientId: locked.clientId,
          entryId: existing.serverEntryId,
          duplicate: true,
          validations: locked.type === "match"
            ? await this.loadValidations(orgId, existing.serverEntryId)
            : [],
        };
      }
      const schema = await this.getSchema(orgId, locked.schemaId);
      if (schema.type !== locked.type) throw new Error("Schema type does not match entry type");
      const validationErrors = validatePayload(schema.definition, locked.payload);
      if (validationErrors.length) throw new Error(validationErrors.join("; "));
      const table = input.type === "match" ? "match_scout_entries" : "pit_scout_entries";
      const update =
        input.type === "match"
          ? await this.client.query(
              `UPDATE match_scout_entries SET payload=$1::jsonb,confidence=$2,source=$3,
                schema_id=$4,updated_at=$5::timestamptz,video_review_id=$9,video_at_seconds=$10,synced_at=now()
               WHERE id=$6 AND org_id=$7 AND scout_user_id=$8
                 AND updated_at <= $5::timestamptz
               RETURNING id`,
              [
                JSON.stringify(locked.payload),
                input.confidence,
                input.source,
                input.schemaId,
                input.updatedAt,
                existing.serverEntryId,
                orgId,
                userId,
                input.videoReviewId ?? null,
                input.videoAtSeconds ?? null,
              ],
            )
          : await this.client.query(
              `UPDATE ${table} SET payload=$1::jsonb,confidence=$2,source=$3,
                schema_id=$4,updated_at=$5::timestamptz,synced_at=now()
               WHERE id=$6 AND org_id=$7 AND scout_user_id=$8
                 AND updated_at <= $5::timestamptz
               RETURNING id`,
              [
                JSON.stringify(locked.payload),
                input.confidence,
                input.source,
                input.schemaId,
                input.updatedAt,
                existing.serverEntryId,
                orgId,
                userId,
              ],
            );
      let validations: FieldValidation[] = [];
      if (update.rowCount) {
        await this.client.query(
          `UPDATE scout_sync_receipts SET payload_hash=$1,acknowledged_at=now()
           WHERE org_id=$2 AND client_id=$3`,
          [hash, orgId, input.clientId],
        );
        if (input.type === "match") {
          await this.refreshDisagreements(orgId, locked, schema);
          validations = await this.refreshOfficialValidations(
            orgId,
            existing.serverEntryId,
            input,
            schema,
          );
        }
      } else if (input.type === "match") {
        validations = await this.loadValidations(orgId, existing.serverEntryId);
      }
      return {
        clientId: input.clientId,
        entryId: existing.serverEntryId,
        duplicate: !update.rowCount,
        validations,
      };
    }

    const schema = await this.getSchema(orgId, input.schemaId);
    if (schema.type !== input.type) throw new Error("Schema type does not match entry type");
    const validationErrors = validatePayload(schema.definition, locked.payload);
    if (validationErrors.length) throw new Error(validationErrors.join("; "));
    if (input.type === "match" && !input.matchKey) throw new Error("Match key is required");

    const entryId = randomUUID();
    const table = input.type === "match" ? "match_scout_entries" : "pit_scout_entries";
    if (input.type === "match") {
      await this.client.query(
        `INSERT INTO match_scout_entries
          (id, org_id, event_key, match_key, team_key, scout_user_id, schema_id,
           payload, confidence, source, client_id, updated_at, video_review_id, video_at_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::timestamptz,$13,$14)`,
        [
          entryId, orgId, input.eventKey, input.matchKey, input.teamKey, userId,
          input.schemaId, JSON.stringify(locked.payload), input.confidence,
          input.source, input.clientId, input.updatedAt,
          input.videoReviewId ?? null, input.videoAtSeconds ?? null,
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
          JSON.stringify(locked.payload), input.confidence, input.source,
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
    let validations: FieldValidation[] = [];
    if (input.type === "match") {
      await this.refreshDisagreements(orgId, locked, schema);
      validations = await this.refreshOfficialValidations(orgId, entryId, locked, schema);
    }
    return { clientId: input.clientId, entryId, duplicate: false, table, validations };
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

  private async loadValidations(orgId: string, entryId: string): Promise<FieldValidation[]> {
    const rows = await this.client.query<{
      fieldKey: string;
      status: FieldValidation["status"];
      scoutValue: unknown;
      officialValue: unknown;
      officialSource: "tba" | "statbotics";
      detail: string;
    }>(
      `SELECT field_key AS "fieldKey",status,scout_value AS "scoutValue",
              official_value AS "officialValue",official_source AS "officialSource",detail
       FROM scout_entry_validations WHERE org_id=$1 AND entry_id=$2
       ORDER BY checked_at DESC`,
      [orgId, entryId],
    );
    return rows.rows.map((row) => ({
      fieldKey: row.fieldKey,
      status: row.status,
      scoutValue: row.scoutValue,
      officialValue: row.officialValue,
      officialSource: row.officialSource,
      officialKey: null,
      detail: row.detail,
      soft: row.officialSource === "statbotics",
    }));
  }

  private async refreshOfficialValidations(
    orgId: string,
    entryId: string,
    input: SyncEntry,
    schema: ScoutSchema,
  ): Promise<FieldValidation[]> {
    if (!input.matchKey) return [];
    const [match, policies, epa] = await Promise.all([
      this.client.query<{
        redAlliance: { teamKeys?: string[] };
        blueAlliance: { teamKeys?: string[] };
        scoreBreakdown: Record<string, unknown> | null;
      }>(
        `SELECT red_alliance AS "redAlliance",blue_alliance AS "blueAlliance",
                score_breakdown AS "scoreBreakdown"
         FROM matches_ref WHERE match_key=$1 AND event_key=$2`,
        [input.matchKey, input.eventKey],
      ),
      this.client.query<{
        fieldKey: string;
        officialKey: string | null;
        teamIndexed: boolean;
        enabled: boolean;
      }>(
        `SELECT field_key AS "fieldKey",official_key AS "officialKey",
                team_indexed AS "teamIndexed",enabled
         FROM scout_field_policies WHERE org_id=$1 AND schema_id=$2`,
        [orgId, schema.id],
      ),
      this.client.query<{ epaEndgame: number | null }>(
        `SELECT epa_endgame AS "epaEndgame"
         FROM team_event_metrics
         WHERE team_key=$1 AND event_key=$2 AND source='statbotics'
         ORDER BY synced_at DESC NULLS LAST LIMIT 1`,
        [input.teamKey, input.eventKey],
      ),
    ]);
    const official = match.rows[0] ?? {
      redAlliance: { teamKeys: [] },
      blueAlliance: { teamKeys: [] },
      scoreBreakdown: null,
    };
    const validations = crossValidateScoutPayload({
      payload: input.payload,
      fieldKeys: schema.definition.fields.map((field) => field.key),
      teamKey: input.teamKey,
      redAlliance: official.redAlliance,
      blueAlliance: official.blueAlliance,
      scoreBreakdown: official.scoreBreakdown,
      policies: policies.rows.map((policy) => ({
        fieldKey: policy.fieldKey,
        officialKey: policy.officialKey,
        teamIndexed: policy.teamIndexed,
        enabled: policy.enabled,
      })),
      epaEndgame: epa.rows[0]?.epaEndgame ?? null,
    });
    for (const validation of validations) {
      const detail =
        input.source === "video" && validation.detail
          ? validation.detail.startsWith("Video re-scout: ")
            ? validation.detail
            : `Video re-scout: ${validation.detail}`
          : input.source === "video"
            ? "Video re-scout: compared against official match data."
            : validation.detail;
      await this.client.query(
        `INSERT INTO scout_entry_validations
          (org_id,entry_id,field_key,scout_value,official_value,official_source,status,detail)
         VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)
         ON CONFLICT(entry_id,field_key,official_source) DO UPDATE SET
           scout_value=excluded.scout_value,official_value=excluded.official_value,
           status=excluded.status,detail=excluded.detail,checked_at=now()`,
        [
          orgId,
          entryId,
          validation.fieldKey,
          JSON.stringify(validation.scoutValue ?? null),
          JSON.stringify(validation.officialValue ?? null),
          validation.officialSource,
          validation.status,
          detail,
        ],
      );
    }
    return validations;
  }
}
