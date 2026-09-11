import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

const SOURCE_KINDS = new Set(["tba", "youtube", "upload", "pit_stream"]);

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
    if (!orgId) throw new Error("Choose your team.");
    const rows = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = await client.query<{
        id: string;
        sourceKind: string;
        sourceRef: string;
        matchKey: string | null;
        status: string;
        minutesBehind: number | null;
        error: string | null;
        createdAt: string;
        result: unknown;
        confirmed: boolean;
      }>(
        `SELECT id,
                source_kind AS "sourceKind",
                source_ref AS "sourceRef",
                match_key AS "matchKey",
                status::text AS status,
                minutes_behind AS "minutesBehind",
                error,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                result,
                COALESCE((checkpoint->>'confirmed')::boolean, false) AS confirmed
         FROM video_analysis_jobs
         WHERE org_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT 50`,
        [orgId],
      );
      return result.rows;
    });
    return Response.json({ jobs: rows });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load videos" },
      { status: error instanceof Error && error.message.includes("Authentication") ? 401 : 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      orgId?: string;
      sourceKind?: string;
      sourceRef?: string;
      matchKey?: string;
    };
    const orgId = String(body.orgId ?? "");
    const sourceKind = String(body.sourceKind ?? "");
    const sourceRef = String(body.sourceRef ?? "").trim();
    if (!orgId) throw new Error("Choose your team.");
    if (!SOURCE_KINDS.has(sourceKind)) {
      throw new Error(
        "Pick a video source: YouTube, The Blue Alliance, an uploaded file, or a pit camera.",
      );
    }
    if (!sourceRef) throw new Error("Paste a video link.");
    if (sourceRef.length > 2000) throw new Error("That video link is too long.");

    const row = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO video_analysis_jobs(org_id, started_by, source_kind, source_ref, match_key)
         VALUES ($1::uuid, $2, $3, $4, $5)
         RETURNING id`,
        [orgId, session.user.id, sourceKind, sourceRef, body.matchKey?.trim() || null],
      );
      return inserted.rows[0];
    });
    return Response.json({ id: row?.id, queued: true }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not start that video" },
      { status: error instanceof Error && error.message.includes("Authentication") ? 401 : 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as { orgId?: string; id?: string; action?: string };
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    if (!orgId) throw new Error("Choose your team.");
    if (!id) throw new Error("Pick a video to confirm.");
    if (body.action !== "confirm") throw new Error("The only action is confirm — that keeps the timeline as video evidence.");

    const updated = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE video_analysis_jobs
         SET checkpoint = COALESCE(checkpoint, '{}'::jsonb) || jsonb_build_object(
               'confirmed', true,
               'confirmedBy', $2::text,
               'confirmedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             ),
             updated_at = now()
         WHERE id = $1::uuid AND org_id = $3::uuid AND status = 'completed'
         RETURNING id`,
        [id, session.user.id, orgId],
      );
      return result.rows[0];
    });
    if (!updated) throw new Error("That video is not finished yet, or it is not yours to confirm.");
    return Response.json({ id: updated.id, confirmed: true, mergedIntoScouting: false });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not confirm that timeline" },
      { status: error instanceof Error && error.message.includes("Authentication") ? 401 : 400 },
    );
  }
}
