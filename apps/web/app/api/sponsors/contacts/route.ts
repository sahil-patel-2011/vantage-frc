import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Sponsor contact request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const sponsorId = url.searchParams.get("sponsorId");
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    const contacts = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT id, sponsor_id AS "sponsorId", name, title, email, phone, is_primary AS "isPrimary", notes
         FROM sponsor_contacts WHERE org_id=$1 AND sponsor_id=$2 ORDER BY is_primary DESC, name`,
        [orgId, sponsorId],
      );
      return result.rows;
    });
    return Response.json({ contacts });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const sponsorId = String(body.sponsorId ?? "");
    const name = String(body.name ?? "").trim();
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    if (!name) throw new Error("Contact name is required");
    const contact = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      if (body.isPrimary) await client.query(`UPDATE sponsor_contacts SET is_primary=false WHERE sponsor_id=$1`, [sponsorId]);
      const result = await client.query(
        `INSERT INTO sponsor_contacts(sponsor_id, org_id, name, title, email, phone, is_primary, notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, sponsor_id AS "sponsorId", name, title, email, phone, is_primary AS "isPrimary", notes`,
        [sponsorId, orgId, name, body.title || null, body.email || null, body.phone || null, Boolean(body.isPrimary), body.notes || null],
      );
      return result.rows[0];
    });
    return Response.json({ contact });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    const name = String(body.name ?? "").trim();
    if (!orgId || !id) throw new Error("orgId and id are required");
    if (!name) throw new Error("Contact name is required");
    const contact = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      if (body.isPrimary) {
        const sponsor = await client.query(`SELECT sponsor_id AS "sponsorId" FROM sponsor_contacts WHERE id=$1 AND org_id=$2`, [id, orgId]);
        if (sponsor.rowCount) await client.query(`UPDATE sponsor_contacts SET is_primary=false WHERE sponsor_id=$1`, [sponsor.rows[0].sponsorId]);
      }
      const result = await client.query(
        `UPDATE sponsor_contacts SET name=$1, title=$2, email=$3, phone=$4, is_primary=$5, notes=$6, updated_at=now()
         WHERE id=$7 AND org_id=$8
         RETURNING id, sponsor_id AS "sponsorId", name, title, email, phone, is_primary AS "isPrimary", notes`,
        [name, body.title || null, body.email || null, body.phone || null, Boolean(body.isPrimary), body.notes || null, id, orgId],
      );
      if (!result.rowCount) throw new Error("Sponsor contact not found");
      return result.rows[0];
    });
    return Response.json({ success: true, contact });
  } catch (error) { return fail(error); }
}
