import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Sponsor interaction request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const sponsorId = url.searchParams.get("sponsorId");
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    const interactions = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT i.id, i.sponsor_id AS "sponsorId", i.type, i.subject, i.notes, i.occurred_at AS "occurredAt",
                i.logged_by AS "loggedBy", u.name AS "loggedByName"
         FROM sponsor_interactions i JOIN users u ON u.id = i.logged_by
         WHERE i.org_id=$1 AND i.sponsor_id=$2 ORDER BY i.occurred_at DESC`,
        [orgId, sponsorId],
      );
      return result.rows;
    });
    return Response.json({ interactions });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const sponsorId = String(body.sponsorId ?? "");
    const type = String(body.type ?? "");
    const validTypes = ["email", "call", "meeting", "event_invite", "thank_you", "other"];
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    if (!validTypes.includes(type)) throw new Error("Invalid interaction type");
    const interaction = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `INSERT INTO sponsor_interactions(sponsor_id, org_id, type, subject, notes, occurred_at, logged_by)
         VALUES($1,$2,$3,$4,$5,COALESCE($6,now()),$7)
         RETURNING id, sponsor_id AS "sponsorId", type, subject, notes, occurred_at AS "occurredAt", logged_by AS "loggedBy"`,
        [sponsorId, orgId, type, body.subject || null, body.notes || null, body.occurredAt || null, current.user.id],
      );
      return result.rows[0];
    });
    return Response.json({ interaction });
  } catch (error) { return fail(error); }
}
