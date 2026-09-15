import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";

const NOTE_MAX = 4000;

type LookupNoteRow = {
  body: string;
  updatedAt: string;
};

function isMissingRelation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const teamKey = url.searchParams.get("teamKey")?.trim() ?? "";
    if (!teamKey) return Response.json({ error: "teamKey is required" }, { status: 400 });
    const result = await withIntelRequest(orgId, async (client) => {
      try {
        const notes = await client.query<LookupNoteRow>(
          `SELECT body, updated_at AS "updatedAt"
           FROM intel_lookup_notes
           WHERE org_id = $1::uuid AND team_key = $2::text
           LIMIT 1`,
          [orgId, teamKey],
        );
        return { note: notes.rows[0] ?? null };
      } catch (error) {
        if (isMissingRelation(error)) return { note: null, setup: true };
        throw error;
      }
    });
    return Response.json(result);
  } catch (error) {
    return intelErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { orgId?: string; teamKey?: string; body?: string };
    const teamKey = body.teamKey?.trim() ?? "";
    const text = typeof body.body === "string" ? body.body : "";
    if (!teamKey) return Response.json({ error: "teamKey is required" }, { status: 400 });
    if (text.length > NOTE_MAX) {
      return Response.json({ error: `Notes stay under ${NOTE_MAX} characters.` }, { status: 400 });
    }
    const result = await withIntelRequest(body.orgId ?? null, async (client) => {
      const user = await client.query<{ id: string }>("SELECT current_app_user_id() AS id");
      const userId = user.rows[0]?.id;
      if (!userId) throw new Error("Could not stamp the author");
      try {
        const notes = await client.query<LookupNoteRow>(
          `INSERT INTO intel_lookup_notes (org_id, team_key, body, updated_by)
           VALUES ($1::uuid, $2::text, $3::text, $4::uuid)
           ON CONFLICT (org_id, team_key) DO UPDATE
             SET body = EXCLUDED.body,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = now()
           RETURNING body, updated_at AS "updatedAt"`,
          [body.orgId, teamKey, text, userId],
        );
        return { note: notes.rows[0] ?? null };
      } catch (error) {
        if (isMissingRelation(error)) return { note: null, setup: true };
        throw error;
      }
    });
    return Response.json(result);
  } catch (error) {
    return intelErrorResponse(error);
  }
}
