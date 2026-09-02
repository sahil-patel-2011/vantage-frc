import { auth } from "@vantage/core";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../../lib/scouting-auth";
import { scoutMediaUrl } from "../../../../../lib/scout-media/client";
import {
  normalizeScoutMediaUsage,
  resolveScoutMediaQuota,
  scoutMediaQuotaSummary,
} from "../../../../../lib/scout-media/quota";
import type { ScoutMediaListItem, ScoutMediaListView } from "../../../../../lib/scout-media/types";

export type { ScoutMediaListItem, ScoutMediaListView };

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 600;
const MAX_LIMIT = 2000;

/**
 * GET /api/scouting/media/list?orgId&eventKey[&teamKey][&limit]
 * Pit photo wall listing: metadata + thumb/full URLs only, never bytes.
 * Without eventKey it falls back to the org's active event.
 */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const requestedEvent = url.searchParams.get("eventKey")?.trim() || null;
    const teamKey = url.searchParams.get("teamKey")?.trim() || null;
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(MAX_LIMIT, Math.floor(limitParam)) : DEFAULT_LIMIT;
    if (requestedEvent && requestedEvent.length > 40) {
      return Response.json({ error: "eventKey is too long" }, { status: 400 });
    }
    if (teamKey && !/^frc\d{1,5}$/i.test(teamKey)) {
      return Response.json({ error: "teamKey must look like frc1234" }, { status: 400 });
    }

    const view = await withScoutingRequest(orgId, async (client): Promise<ScoutMediaListView> => {
      const membership = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, session.user.id],
      );
      const role = membership.rows[0]?.role ?? "viewer";
      const canModerate = role === "owner" || role === "admin";

      let eventKey = requestedEvent;
      if (!eventKey) {
        const active = await client.query<{ eventKey: string | null }>(
          `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
          [orgId],
        );
        eventKey = active.rows[0]?.eventKey ?? null;
      }
      if (!eventKey) {
        return {
          status: "setup_required",
          eventKey: null,
          message: "Set an active event for this workspace, then pit photos group by team here.",
          items: [],
          orgId: orgId!,
        };
      }

      const rows = await client.query<{
        clientId: string;
        eventKey: string;
        teamKey: string;
        teamNumber: number | null;
        teamNickname: string | null;
        kind: string;
        contentType: string;
        byteSize: number;
        width: number | null;
        height: number | null;
        thumbWidth: number | null;
        thumbHeight: number | null;
        hasThumb: boolean;
        capturedBy: string;
        capturedByName: string | null;
        capturedAt: string;
        entryId: string | null;
        entryClientId: string | null;
        tags: string[] | null;
      }>(
        `SELECT m.client_id AS "clientId",
                m.event_key AS "eventKey",
                m.team_key AS "teamKey",
                t.team_number AS "teamNumber",
                t.nickname AS "teamNickname",
                m.kind::text AS kind,
                m.content_type AS "contentType",
                m.byte_size AS "byteSize",
                m.width, m.height,
                m.thumb_width AS "thumbWidth",
                m.thumb_height AS "thumbHeight",
                (m.thumb_bytes IS NOT NULL) AS "hasThumb",
                m.captured_by AS "capturedBy",
                COALESCE(p.display_name, u.name) AS "capturedByName",
                m.created_at::text AS "capturedAt",
                m.entry_id AS "entryId",
                m.entry_client_id AS "entryClientId",
                m.tags
         FROM scout_media m
         LEFT JOIN teams_ref t ON t.team_key = m.team_key
         LEFT JOIN users u ON u.id = m.captured_by
         LEFT JOIN profiles p ON p.user_id = m.captured_by
         WHERE m.org_id = $1::uuid
           AND m.event_key = $2
           AND ($3::text IS NULL OR m.team_key = $3::text)
           AND m.kind = 'photo'
           AND m.status = 'uploaded'
           AND m.deleted_at IS NULL
           AND m.bytes IS NOT NULL
         ORDER BY t.team_number NULLS LAST, m.team_key, m.created_at DESC
         LIMIT $4::int`,
        [orgId, eventKey, teamKey, limit + 1],
      );

      const [quotaRow, usageRow] = await Promise.all([
        client.query<{ maxItems: number; maxBytes: string }>(
          `SELECT max_items AS "maxItems", max_bytes::text AS "maxBytes"
           FROM scout_media_quota WHERE org_id = $1::uuid`,
          [orgId],
        ),
        client.query<{ items: number; bytes: string }>(
          `SELECT count(*)::int AS items,
                  COALESCE(SUM(byte_size + COALESCE(octet_length(thumb_bytes), 0)), 0)::text AS bytes
           FROM scout_media
           WHERE org_id = $1::uuid AND status = 'uploaded' AND deleted_at IS NULL`,
          [orgId],
        ),
      ]);

      const truncated = rows.rows.length > limit;
      const items: ScoutMediaListItem[] = rows.rows.slice(0, limit).map((row) => ({
        clientId: row.clientId,
        eventKey: row.eventKey,
        teamKey: row.teamKey,
        teamNumber: row.teamNumber,
        teamNickname: row.teamNickname,
        kind: row.kind,
        contentType: row.contentType,
        byteSize: row.byteSize,
        width: row.width,
        height: row.height,
        thumbWidth: row.thumbWidth,
        thumbHeight: row.thumbHeight,
        hasThumb: row.hasThumb,
        capturedBy: row.capturedBy,
        capturedByName: row.capturedByName,
        capturedAt: row.capturedAt,
        entryId: row.entryId,
        entryClientId: row.entryClientId,
        tags: row.tags ?? [],
        url: scoutMediaUrl(orgId!, row.clientId),
        thumbUrl: scoutMediaUrl(orgId!, row.clientId, row.hasThumb ? "thumb" : "full"),
        canDelete: canModerate || row.capturedBy === session.user.id,
      }));

      return {
        status: items.length ? "live" : "empty",
        orgId: orgId!,
        eventKey,
        teamKey,
        items,
        truncated,
        viewer: { userId: session.user.id, role },
        quota: scoutMediaQuotaSummary(
          normalizeScoutMediaUsage(usageRow.rows[0]),
          resolveScoutMediaQuota(quotaRow.rows[0]),
        ),
        generatedAt: new Date().toISOString(),
      };
    });

    return Response.json(view, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
