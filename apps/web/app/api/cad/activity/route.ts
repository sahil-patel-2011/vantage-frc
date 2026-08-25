import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { cadActivityFilters, cadActivityDetailFrom } from "../../../../lib/cad/cad-activity";

export type CadActivityRow = {
  id: string;
  source: "terminal" | "web";
  title: string;
  platform: string;
  status: string;
  documentName: string | null;
  documentUrl: string | null;
  machineName: string | null;
  authorName: string | null;
  mine: boolean;
  toolCallCount: number;
  lastTool: string | null;
  updatedAt: string;
};

/**
 * One org-scoped list for the /cad "Recent CAD activity" panel: web agent
 * sessions and vantage-cad terminal sessions live in the same cad_jobs table
 * (terminal rows carry brief->>'kind'='cad_cli', written by /api/cad/sync).
 *
 * Filters (`scope`, `source`) narrow the same RLS-protected query — they never
 * widen it. RLS already limits rows to the caller's org; `scope=mine` adds a
 * created_by predicate on top.
 *
 * `sessionId` switches to detail mode: the tool calls (terminal) or narrated
 * steps (web) of one session, for the expand-in-place row.
 */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const orgId = params.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const userId = session.user.id;
    const sessionId = params.get("sessionId");

    if (sessionId) {
      const detail = await withRls({ userId, orgId }, async (client) => {
        const result = await client.query<{
          id: string;
          kind: string | null;
          status: string;
          brief: unknown;
          document_ref: unknown;
          updated_at: string;
        }>(
          `SELECT id, brief->>'kind' AS kind, status, brief, document_ref, updated_at
             FROM cad_jobs
            WHERE org_id=$1::uuid AND id=$2::uuid
            LIMIT 1`,
          [orgId, sessionId],
        );
        return result.rows[0] ?? null;
      });
      if (!detail) return Response.json({ error: "CAD session not found" }, { status: 404 });
      return Response.json({ detail: cadActivityDetailFrom(detail) });
    }

    const filters = cadActivityFilters({ scope: params.get("scope"), source: params.get("source") });
    const activity = await withRls({ userId, orgId }, async (client) => {
      const result = await client.query<CadActivityRow>(
        `SELECT j.id,
                CASE WHEN j.brief->>'kind'='cad_cli' THEN 'terminal' ELSE 'web' END AS source,
                j.title,
                j.platform,
                j.status,
                COALESCE(j.document_ref->>'documentName', j.document_ref->>'documentId') AS "documentName",
                j.document_ref->>'url' AS "documentUrl",
                j.brief->>'machineName' AS "machineName",
                u.name AS "authorName",
                (j.created_by = $2::uuid) AS mine,
                CASE WHEN jsonb_typeof(j.brief->'toolCalls')='array'
                     THEN jsonb_array_length(j.brief->'toolCalls')
                     WHEN jsonb_typeof(j.brief->'steps')='array'
                     THEN jsonb_array_length(j.brief->'steps')
                     ELSE 0 END AS "toolCallCount",
                CASE WHEN jsonb_typeof(j.brief->'toolCalls')='array' AND jsonb_array_length(j.brief->'toolCalls')>0
                     THEN j.brief->'toolCalls'->-1->>'tool'
                     WHEN jsonb_typeof(j.brief->'steps')='array' AND jsonb_array_length(j.brief->'steps')>0
                     THEN j.brief->'steps'->-1->>'tool'
                     ELSE NULL END AS "lastTool",
                j.updated_at AS "updatedAt"
         FROM cad_jobs j
         LEFT JOIN users u ON u.id = j.created_by
         WHERE j.org_id=$1::uuid
           AND ($3::boolean IS FALSE OR j.created_by = $2::uuid)
           AND ($4::text IS NULL
                OR ($4 = 'terminal' AND j.brief->>'kind'='cad_cli')
                OR ($4 = 'web' AND j.brief->>'kind' IS DISTINCT FROM 'cad_cli'))
         ORDER BY j.updated_at DESC
         LIMIT 25`,
        [orgId, userId, filters.mineOnly, filters.sourceParam],
      );
      return result.rows;
    });
    return Response.json({ activity, filters });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load CAD activity" },
      { status: 400 },
    );
  }
}
