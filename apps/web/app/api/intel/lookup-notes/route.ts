import { IntelHttpError, intelErrorResponse, intelSession, withIntelRequest } from "../../../../lib/intel-auth";
import { canEditLookupNotes, parseLookupNote, sanitizeLookupNote } from "../../../../lib/intel/lookup-notes";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const teamKey = url.searchParams.get("teamKey")?.trim() ?? "";
    if (!teamKey) return Response.json({ error: "teamKey is required" }, { status: 400 });
    return Response.json(
      await withIntelRequest(orgId, async (client) => {
        const session = await intelSession();
        const role = await client.query<{ role: string }>(
          `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
          [orgId, session.user.id],
        );
        const canEdit = canEditLookupNotes(role.rows[0]?.role ?? null);
        const row = await client.query<{ body: string; updatedAt: string; updatedBy: string }>(
          `SELECT body, updated_at AS "updatedAt", updated_by::text AS "updatedBy"
             FROM team_lookup_notes
            WHERE org_id = $1::uuid AND team_key = $2::text`,
          [orgId, teamKey],
        );
        return { note: parseLookupNote(row.rows[0] ?? null, teamKey, canEdit) };
      }),
    );
  } catch (error) {
    return intelErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = typeof body.orgId === "string" ? body.orgId : null;
    const teamKey = typeof body.teamKey === "string" ? body.teamKey.trim() : "";
    const text = sanitizeLookupNote(body.body);
    if (!teamKey) return Response.json({ error: "teamKey is required" }, { status: 400 });
    return Response.json(
      await withIntelRequest(orgId, async (client) => {
        const session = await intelSession();
        const role = await client.query<{ role: string }>(
          `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
          [orgId, session.user.id],
        );
        if (!canEditLookupNotes(role.rows[0]?.role ?? null)) {
          throw new IntelHttpError(403, "Coach role required to edit this note.");
        }
        const row = await client.query<{ body: string; updatedAt: string; updatedBy: string }>(
          `INSERT INTO team_lookup_notes (org_id, team_key, body, updated_by)
           VALUES ($1::uuid, $2::text, $3::text, $4::uuid)
           ON CONFLICT (org_id, team_key)
           DO UPDATE SET body = excluded.body, updated_by = excluded.updated_by, updated_at = now()
           RETURNING body, updated_at AS "updatedAt", updated_by::text AS "updatedBy"`,
          [orgId, teamKey, text, session.user.id],
        );
        return { note: parseLookupNote(row.rows[0] ?? { body: text }, teamKey, true) };
      }),
    );
  } catch (error) {
    return intelErrorResponse(error);
  }
}
