import { auth } from "@vantage/core";
import {
  zipCandidates,
  type DisagreementResolution,
} from "@vantage/scouting";
import { headers } from "next/headers";
import { applyDisagreementResolution } from "../../../../lib/scouting/apply-disagreement-resolution";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const eventKey = url.searchParams.get("eventKey");
    const result = await withScoutingRequest(orgId, async (client) => {
      const disagreements = await client.query<{
        id: string;
        matchKey: string;
        teamKey: string;
        fieldKey: string;
        entryIds: string[];
        values: unknown[];
        status: string;
        resolution: DisagreementResolution | Record<string, unknown> | null;
        reviewedAt: string | null;
        reviewedByName: string | null;
        winningEntryId: string | null;
        winningScoutUserId: string | null;
        chosenValue: unknown;
      }>(
        `SELECT d.id, d.match_key AS "matchKey", d.team_key AS "teamKey",
                d.field_key AS "fieldKey", d.entry_ids AS "entryIds", d.values, d.status,
                d.resolution, d.reviewed_at::text AS "reviewedAt",
                u.name AS "reviewedByName",
                d.winning_entry_id AS "winningEntryId",
                d.winning_scout_user_id AS "winningScoutUserId",
                d.chosen_value AS "chosenValue"
         FROM scout_disagreements d
         LEFT JOIN users u ON u.id = d.reviewed_by
         WHERE d.org_id = $1 AND ($2::text IS NULL OR d.event_key = $2)
         ORDER BY CASE d.status WHEN 'open' THEN 0 ELSE 1 END, d.updated_at DESC`,
        [orgId, eventKey],
      );

      const entryIds = [...new Set(disagreements.rows.flatMap((row) => row.entryIds ?? []))];
      const entries = entryIds.length
        ? await client.query<{
            id: string;
            scoutUserId: string;
            scoutName: string;
          }>(
            `SELECT e.id, e.scout_user_id::text AS "scoutUserId",
                    COALESCE(u.name, u.email, 'Team scout') AS "scoutName"
             FROM match_scout_entries e
             LEFT JOIN users u ON u.id = e.scout_user_id
             WHERE e.org_id = $1 AND e.id = ANY($2::uuid[])`,
            [orgId, entryIds],
          )
        : { rows: [] as Array<{ id: string; scoutUserId: string; scoutName: string }> };

      const disagreementIds = disagreements.rows.map((row) => row.id);
      let auditRows: Array<{
        id: string;
        disagreementId: string;
        action: string;
        actorName: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        createdAt: string;
      }> = [];
      if (disagreementIds.length) {
        try {
          const audit = await client.query<{
            id: string;
            disagreementId: string;
            action: string;
            actorName: string;
            before: Record<string, unknown> | null;
            after: Record<string, unknown> | null;
            createdAt: string;
          }>(
            `SELECT a.id, a.disagreement_id AS "disagreementId", a.action,
                    COALESCE(u.name, u.email, 'Member') AS "actorName",
                    a.before, a.after, a.created_at::text AS "createdAt"
             FROM scout_disagreement_audit a
             LEFT JOIN users u ON u.id = a.actor_user_id
             WHERE a.org_id = $1 AND a.disagreement_id = ANY($2::uuid[])
             ORDER BY a.created_at DESC`,
            [orgId, disagreementIds],
          );
          auditRows = audit.rows;
        } catch {
          auditRows = [];
        }
      }

      const auditById = new Map<string, typeof auditRows>();
      for (const row of auditRows) {
        const list = auditById.get(row.disagreementId) ?? [];
        list.push(row);
        auditById.set(row.disagreementId, list);
      }

      return disagreements.rows.map((row) => {
        const scouts = entries.rows.map((entry) => ({
          entryId: entry.id,
          scoutUserId: entry.scoutUserId,
          scoutName: entry.scoutName,
        }));
        const candidates = zipCandidates(row.entryIds ?? [], row.values ?? [], scouts);
        const resolutionName =
          row.resolution &&
          typeof row.resolution === "object" &&
          "winningScoutName" in row.resolution &&
          typeof (row.resolution as { winningScoutName?: unknown }).winningScoutName === "string"
            ? (row.resolution as { winningScoutName: string }).winningScoutName
            : null;
        const winningScoutName =
          resolutionName ??
          (row.winningScoutUserId
            ? entries.rows.find((entry) => entry.scoutUserId === row.winningScoutUserId)?.scoutName ??
              null
            : null);
        return {
          ...row,
          candidates,
          winningScoutName,
          audit: auditById.get(row.id) ?? [],
        };
      });
    });
    return Response.json({ disagreements: result });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as {
      orgId?: string;
      id?: string;
      status?: "resolved" | "dismissed";
      winningEntryId?: string | null;
      note?: string | null;
    };
    if (!body.id || !body.status) {
      return Response.json({ error: "Review id and status are required" }, { status: 400 });
    }
    if (body.status !== "resolved" && body.status !== "dismissed") {
      return Response.json({ error: "Status must be resolved or dismissed" }, { status: 400 });
    }
    if (body.status === "resolved" && !body.winningEntryId?.trim()) {
      return Response.json({ error: "Pick which scout was right before resolving" }, { status: 400 });
    }

    const result = await withScoutingRequest(body.orgId ?? null, async (client) => {
      const allowed = await client.query(
        `SELECT has_org_role($1, ARRAY['owner','admin']::org_role[]) AS allowed`,
        [body.orgId],
      );
      if (!allowed.rows[0]?.allowed) throw new Error("Coach role required");
      return applyDisagreementResolution(client, {
        orgId: body.orgId!,
        disagreementId: body.id!,
        reviewerUserId: session.user.id,
        status: body.status!,
        winningEntryId: body.winningEntryId,
        note: body.note,
      });
    });

    return Response.json(result);
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
