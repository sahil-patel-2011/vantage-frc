import { auth, emitPreferredNotification } from "@vantage/core";
import type { SchemaDefinition } from "@vantage/scouting";
import {
  buildCoverageBoard,
  coverageGapFingerprint,
  coverageGapMessage,
  coverageState,
  fatigueAwareAssignments,
  lintSchemaBudget,
  rankScoutsByAccuracy,
  summarizeFieldTrust,
} from "@vantage/scouting/trust";
import { headers } from "next/headers";
import { scoutingErrorResponse, withScoutingRequest } from "../../../../lib/scouting-auth";
import { seatTopAccurateScouts } from "../../../../lib/scouting/pick-feedback";

type Alliance = { teamKeys?: string[] };
type MatchRow = { matchKey: string; matchNumber: number; compLevel: string; redAlliance: Alliance; blueAlliance: Alliance };
type CountRow = { matchKey: string; teamKey: string; count: number };
const text = (value: unknown, maximum = 160) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const yearNow = () => new Date().getUTCFullYear();

async function load(orgId: string, userId: string, eventKeyOverride?: string | null) {
  return withScoutingRequest(orgId, async (client) => {
    const context = await client.query<{ eventKey: string | null; role: string }>(
      `SELECT c.active_event_key AS "eventKey",m.role::text AS role
       FROM memberships m LEFT JOIN org_active_context c ON c.org_id=m.org_id
       WHERE m.org_id=$1 AND m.user_id=$2`,
      [orgId, userId],
    );
    const eventKey = eventKeyOverride || context.rows[0]?.eventKey || null;
    const [schemas, validations, policies, health, leaderboard, influence, seats] = await Promise.all([
      client.query<{ id: string; year: number; type: "match" | "pit"; version: number; definition: { title: string; fields: Array<{ key: string; label: string; type: string }> }; clonedFrom: string | null }>(
        `SELECT id,year,type,version,schema AS definition,cloned_from_schema_id AS "clonedFrom"
         FROM scout_schemas WHERE org_id=$1 ORDER BY year DESC,type,version DESC`, [orgId]),
      eventKey ? client.query<{ fieldKey: string; status: "match" | "conflict" | "unavailable" | "not_comparable" }>(
        `SELECT v.field_key AS "fieldKey",v.status
         FROM scout_entry_validations v JOIN match_scout_entries e ON e.id=v.entry_id
         WHERE v.org_id=$1 AND e.event_key=$2`, [orgId, eventKey]) : Promise.resolve({ rows: [] }),
      client.query<{ schemaId: string; fieldKey: string; preferredSource: string; officialKey: string | null; teamIndexed: boolean; enabled: boolean }>(
        `SELECT schema_id AS "schemaId",field_key AS "fieldKey",preferred_source AS "preferredSource",
                official_key AS "officialKey",team_indexed AS "teamIndexed",enabled
         FROM scout_field_policies WHERE org_id=$1 ORDER BY field_key`, [orgId]),
      client.query<{ source: string; status: string; consecutiveFailures: number; lastSuccessAt: string | null; lastFailureAt: string | null; updatedAt: string }>(
        `SELECT source,status,consecutive_failures AS "consecutiveFailures",
                last_success_at::text AS "lastSuccessAt",last_failure_at::text AS "lastFailureAt",updated_at::text AS "updatedAt"
         FROM data_source_health WHERE source IN ('tba','statbotics') ORDER BY source`),
      eventKey ? client.query<{ userId: string; name: string; entries: number; checks: number; matches: number; conflicts: number }>(
        `SELECT e.scout_user_id AS "userId",COALESCE(u.name,'Team scout') AS name,
                count(DISTINCT e.id)::int AS entries,
                count(v.id) FILTER (WHERE v.status IN ('match','conflict'))::int AS checks,
                count(v.id) FILTER (WHERE v.status='match')::int AS matches,
                count(v.id) FILTER (WHERE v.status='conflict')::int AS conflicts
         FROM match_scout_entries e JOIN users u ON u.id=e.scout_user_id
         LEFT JOIN scout_entry_validations v ON v.entry_id=e.id
         WHERE e.org_id=$1 AND e.event_key=$2
         GROUP BY e.scout_user_id,u.name ORDER BY matches DESC,entries DESC`, [orgId, eventKey]) : Promise.resolve({ rows: [] }),
      eventKey ? client.query<{
        entryId: string;
        teamKey: string;
        reason: string;
        recordedAt: string;
        matchKey: string | null;
        pickListName: string | null;
        teamNumber: number | null;
        nickname: string | null;
      }>(
        `SELECT i.entry_id AS "entryId", i.team_key AS "teamKey", i.reason,
                i.recorded_at::text AS "recordedAt", e.match_key AS "matchKey",
                pl.name AS "pickListName", t.team_number AS "teamNumber", t.nickname
         FROM scout_pick_influence i
         JOIN match_scout_entries e ON e.id = i.entry_id
         LEFT JOIN pick_lists pl ON pl.id = i.pick_list_id
         LEFT JOIN teams_ref t ON t.team_key = i.team_key
         WHERE i.org_id = $1 AND i.event_key = $2 AND e.scout_user_id = $3
         ORDER BY i.recorded_at DESC
         LIMIT 40`,
        [orgId, eventKey, userId]) : Promise.resolve({ rows: [] }),
      eventKey ? client.query<{ userId: string; name: string; meetingOn: string; reason: string }>(
        `SELECT s.user_id AS "userId",COALESCE(u.name,'Team scout') AS name,s.meeting_on::text AS "meetingOn",s.reason
         FROM scout_strategy_seats s JOIN users u ON u.id=s.user_id
         WHERE s.org_id=$1 AND s.event_key=$2 ORDER BY s.meeting_on DESC`, [orgId, eventKey]) : Promise.resolve({ rows: [] }),
    ]);

    let coverage: Array<Record<string, unknown>> = [];
    if (eventKey) {
      const [matches, assignments, entries] = await Promise.all([
        client.query<MatchRow>(
          `SELECT match_key AS "matchKey",match_number AS "matchNumber",comp_level AS "compLevel",
                  red_alliance AS "redAlliance",blue_alliance AS "blueAlliance"
           FROM matches_ref WHERE event_key=$1 ORDER BY CASE comp_level WHEN 'qm' THEN 0 ELSE 1 END,match_number`, [eventKey]),
        client.query<CountRow>(
          `SELECT match_key AS "matchKey",team_key AS "teamKey",count(*)::int AS count
           FROM scout_assignments WHERE org_id=$1 AND event_key=$2 GROUP BY match_key,team_key`, [orgId, eventKey]),
        client.query<CountRow>(
          `SELECT match_key AS "matchKey",team_key AS "teamKey",count(*)::int AS count
           FROM match_scout_entries WHERE org_id=$1 AND event_key=$2 GROUP BY match_key,team_key`, [orgId, eventKey]),
      ]);
      const assignmentMap = new Map(assignments.rows.map((row) => [`${row.matchKey}|${row.teamKey}`, Number(row.count)]));
      const entryMap = new Map(entries.rows.map((row) => [`${row.matchKey}|${row.teamKey}`, Number(row.count)]));
      coverage = matches.rows.flatMap((match) => [...(match.redAlliance?.teamKeys ?? []), ...(match.blueAlliance?.teamKeys ?? [])].map((teamKey) => {
        const key = `${match.matchKey}|${teamKey}`;
        const cell = { matchKey: match.matchKey, teamKey, assignmentCount: assignmentMap.get(key) ?? 0, entryCount: entryMap.get(key) ?? 0 };
        return { ...cell, matchNumber: match.matchNumber, compLevel: match.compLevel, state: coverageState(cell) };
      }));
    }
    const latestSchemas = schemas.rows.filter((schema, index, all) => all.findIndex((candidate) => candidate.year === schema.year && candidate.type === schema.type) === index);
    return {
      eventKey,
      canManage: ["owner", "admin"].includes(context.rows[0]?.role ?? ""),
      schemaBudgets: latestSchemas.map((schema) => ({ schemaId: schema.id, year: schema.year, type: schema.type, title: schema.definition.title, version: schema.version, clonedFrom: schema.clonedFrom, fields: schema.definition.fields, ...lintSchemaBudget(schema.definition as SchemaDefinition) })),
      fieldTrust: summarizeFieldTrust(validations.rows),
      policies: policies.rows,
      sourceHealth: health.rows,
      coverage,
      leaderboard: rankScoutsByAccuracy(leaderboard.rows),
      myInfluence: influence.rows,
      strategySeats: seats.rows,
      mySeat: seats.rows.find((seat) => seat.userId === userId) ?? null,
    };
  });
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    return Response.json(await load(orgId, session.user.id, url.searchParams.get("eventKey")), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return scoutingErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const orgId = text(body.orgId, 64);
    const action = text(body.action, 40);
    if (!orgId || !action) return Response.json({ error: "orgId and action are required" }, { status: 400 });
    await withScoutingRequest(orgId, async (client) => {
      const membership = await client.query<{ role: string }>(`SELECT role::text AS role FROM memberships WHERE org_id=$1 AND user_id=$2`, [orgId, session.user.id]);
      if (!["owner", "admin"].includes(membership.rows[0]?.role ?? "")) throw new Error("Owner or admin role required");
      if (action === "set-policy") {
        const schemaId = text(body.schemaId, 64), fieldKey = text(body.fieldKey, 120);
        const preferred = text(body.preferredSource, 20);
        if (!schemaId || !fieldKey || !["scout", "tba", "statbotics", "consensus"].includes(preferred)) throw new Error("Valid schema, field, and source are required");
        await client.query(
          `INSERT INTO scout_field_policies(org_id,schema_id,field_key,preferred_source,official_key,team_indexed,enabled,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(org_id,schema_id,field_key) DO UPDATE SET preferred_source=excluded.preferred_source,
             official_key=excluded.official_key,team_indexed=excluded.team_indexed,enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now()`,
          [orgId, schemaId, fieldKey, preferred, text(body.officialKey, 120) || null, Boolean(body.teamIndexed), body.enabled !== false, session.user.id],
        );
      } else if (action === "clone-previous") {
        const targetYear = Number(body.targetYear ?? yearNow());
        const type = text(body.type, 12);
        if (!Number.isInteger(targetYear) || !["match", "pit"].includes(type)) throw new Error("Valid target year and type required");
        const source = await client.query<{ id: string; definition: unknown }>(
          `SELECT id,schema AS definition FROM scout_schemas WHERE org_id=$1 AND year<$2 AND type=$3 ORDER BY year DESC,version DESC LIMIT 1`,
          [orgId, targetYear, type],
        );
        if (!source.rows[0]) throw new Error("No previous-season schema exists for this form type");
        await client.query(
          `INSERT INTO scout_schemas(org_id,year,type,version,schema,created_by,cloned_from_schema_id)
           SELECT $1,$2,$3,COALESCE(max(version),0)+1,$4::jsonb,$5,$6 FROM scout_schemas WHERE org_id=$1 AND year=$2 AND type=$3`,
          [orgId, targetYear, type, JSON.stringify(source.rows[0].definition), session.user.id, source.rows[0].id],
        );
      } else if (action === "auto-assign") {
        const eventKey = text(body.eventKey, 80);
        const maximum = Math.max(1, Math.min(8, Number(body.maximumConsecutiveMatches ?? 3)));
        const requested = Array.isArray(body.scoutUserIds) ? body.scoutUserIds.map((value) => text(value, 64)).filter(Boolean) : [];
        const scouts = requested.length ? requested : (await client.query<{ userId: string }>(
          `SELECT user_id AS "userId" FROM memberships WHERE org_id=$1 AND role IN ('owner','admin','scout') ORDER BY created_at`, [orgId])).rows.map((row) => row.userId);
        const matches = await client.query<MatchRow>(
          `SELECT match_key AS "matchKey",match_number AS "matchNumber",comp_level AS "compLevel",red_alliance AS "redAlliance",blue_alliance AS "blueAlliance"
           FROM matches_ref WHERE event_key=$1 AND comp_level='qm' ORDER BY match_number`, [eventKey]);
        const balanced = fatigueAwareAssignments({ scouts, maximumConsecutiveMatches: maximum, matches: matches.rows.map((match) => ({ matchKey: match.matchKey, teamKeys: [...(match.redAlliance.teamKeys ?? []), ...(match.blueAlliance.teamKeys ?? [])] })) });
        for (const assignment of balanced.assignments) {
          await client.query(
            `INSERT INTO scout_assignments(org_id,event_key,user_id,match_key,team_key,role)
             VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,user_id,match_key,team_key) DO UPDATE SET role=excluded.role`,
            [orgId, eventKey, assignment.userId, assignment.matchKey, assignment.teamKey, assignment.fatigueWarning ? "primary-fatigue-cap" : "primary"],
          );
        }
      } else if (action === "nudge-gaps") {
        const eventKey = text(body.eventKey, 80);
        const [matches, assignments, entries] = await Promise.all([
          client.query<MatchRow>(
            `SELECT match_key AS "matchKey",match_number AS "matchNumber",comp_level AS "compLevel",
                    red_alliance AS "redAlliance",blue_alliance AS "blueAlliance"
             FROM matches_ref WHERE event_key=$1 ORDER BY CASE comp_level WHEN 'qm' THEN 0 ELSE 1 END,match_number`,
            [eventKey],
          ),
          client.query<CountRow>(
            `SELECT match_key AS "matchKey",team_key AS "teamKey",count(*)::int AS count
             FROM scout_assignments WHERE org_id=$1 AND event_key=$2 GROUP BY match_key,team_key`,
            [orgId, eventKey],
          ),
          client.query<CountRow>(
            `SELECT match_key AS "matchKey",team_key AS "teamKey",count(*)::int AS count
             FROM match_scout_entries WHERE org_id=$1 AND event_key=$2 GROUP BY match_key,team_key`,
            [orgId, eventKey],
          ),
        ]);
        const assignmentCounts = new Map(assignments.rows.map((row) => [`${row.matchKey}|${row.teamKey}`, Number(row.count)]));
        const entryCounts = new Map(entries.rows.map((row) => [`${row.matchKey}|${row.teamKey}`, Number(row.count)]));
        const board = buildCoverageBoard({
          matches: matches.rows.map((match) => ({
            matchKey: match.matchKey,
            matchNumber: match.matchNumber,
            compLevel: match.compLevel,
            teamKeys: [...(match.redAlliance?.teamKeys ?? []), ...(match.blueAlliance?.teamKeys ?? [])],
          })),
          assignmentCounts,
          entryCounts,
        });
        const missing = board.filter((cell) => cell.state === "missing");
        const fingerprint = coverageGapFingerprint(missing);
        const message =
          text(body.message, 500) ||
          coverageGapMessage({ eventKey, missing: missing.length || 1, sample: missing });
        const href = `/command?orgId=${encodeURIComponent(orgId)}`;
        const recipients = await client.query<{ userId: string }>(
          `SELECT user_id AS "userId" FROM memberships WHERE org_id=$1 AND role IN ('owner','admin')`,
          [orgId],
        );
        for (const recipient of recipients.rows) {
          await emitPreferredNotification(client, {
            userId: recipient.userId,
            orgId,
            type: "scouting_coverage_gap",
            payload: {
              title: "Scouting coverage gap",
              message,
              body: message,
              eventKey,
              fingerprint,
              missingRows: missing.length,
              href,
            },
          });
        }
      } else if (action === "strategy-seat") {
        const eventKey = text(body.eventKey, 80), userId = text(body.userId, 64), meetingOn = text(body.meetingOn, 10);
        if (!eventKey || !userId || !/^\d{4}-\d{2}-\d{2}$/.test(meetingOn)) throw new Error("Event, scout, and meeting date required");
        const reason = text(body.reason, 500);
        await client.query(
          `INSERT INTO scout_strategy_seats(org_id,event_key,user_id,meeting_on,reason,assigned_by)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,event_key,user_id,meeting_on) DO UPDATE SET reason=excluded.reason,assigned_by=excluded.assigned_by`,
          [orgId, eventKey, userId, meetingOn, reason, session.user.id],
        );
        await emitPreferredNotification(client, {
          userId,
          orgId,
          type: "scout_strategy_seat",
          payload: {
            title: "Strategy meeting seat",
            eventKey,
            meetingOn,
            href: `/strategy?orgId=${encodeURIComponent(orgId)}&tab=picks`,
            message: reason || `You earned a strategy seat for ${meetingOn}.`,
          },
        });
      } else if (action === "seat-top-accurate") {
        const eventKey = text(body.eventKey, 80);
        if (!eventKey) throw new Error("Event key required");
        await seatTopAccurateScouts(client, {
          orgId,
          eventKey,
          assignedBy: session.user.id,
          seatCount: Number(body.seatCount ?? 3),
          meetingOn: text(body.meetingOn, 10) || undefined,
        });
      } else if (action === "record-influence") {
        const eventKey = text(body.eventKey, 80), teamKey = text(body.teamKey, 24), entryId = text(body.entryId, 64);
        if (!eventKey || !teamKey || !entryId) throw new Error("Event, team, and entry required");
        await client.query(
          `INSERT INTO scout_pick_influence(org_id,event_key,pick_list_id,team_key,entry_id,reason,recorded_by)
           VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id,event_key,team_key,entry_id) DO UPDATE SET reason=excluded.reason,recorded_by=excluded.recorded_by,recorded_at=now()`,
          [orgId, eventKey, text(body.pickListId, 64) || null, teamKey, entryId, text(body.reason, 500), session.user.id],
        );
      } else throw new Error("Unsupported scouting trust action");
    });
    return Response.json(await load(orgId, session.user.id, text(body.eventKey, 80) || null));
  } catch (error) { return scoutingErrorResponse(error); }
}
