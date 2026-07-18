import { withRls } from "@vantage/db";
import {
  requireOrgAdmin,
  requireOrgMember,
  requireSponsorInOrg,
  requireTenantSession,
  tenantErrorResponse,
} from "../../../../lib/tenant-org-access";

export async function GET(request: Request) {
  try {
    const current = await requireTenantSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const sponsorId = url.searchParams.get("sponsorId");
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    const contacts = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, current.user.id);
      await requireSponsorInOrg(client, orgId, sponsorId);
      const result = await client.query(
        `SELECT id, sponsor_id AS "sponsorId", name, title, email, phone, is_primary AS "isPrimary", notes
         FROM sponsor_contacts WHERE org_id=$1::uuid AND sponsor_id=$2::uuid ORDER BY is_primary DESC, name`,
        [orgId, sponsorId],
      );
      return result.rows;
    });
    return Response.json({ contacts });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor contact request failed");
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const sponsorId = String(body.sponsorId ?? "");
    const name = String(body.name ?? "").trim();
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    if (!name) throw new Error("Contact name is required");
    const contact = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      await requireSponsorInOrg(client, orgId, sponsorId);
      if (body.isPrimary) {
        await client.query(
          `UPDATE sponsor_contacts SET is_primary=false WHERE sponsor_id=$1::uuid AND org_id=$2::uuid`,
          [sponsorId, orgId],
        );
      }
      const result = await client.query(
        `INSERT INTO sponsor_contacts(sponsor_id, org_id, name, title, email, phone, is_primary, notes)
         VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8)
         RETURNING id, sponsor_id AS "sponsorId", name, title, email, phone, is_primary AS "isPrimary", notes`,
        [sponsorId, orgId, name, body.title || null, body.email || null, body.phone || null, Boolean(body.isPrimary), body.notes || null],
      );
      return result.rows[0];
    });
    return Response.json({ contact });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor contact request failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    const name = String(body.name ?? "").trim();
    if (!orgId || !id) throw new Error("orgId and id are required");
    if (!name) throw new Error("Contact name is required");
    const contact = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      if (body.isPrimary) {
        const sponsor = await client.query(
          `SELECT sponsor_id AS "sponsorId" FROM sponsor_contacts WHERE id=$1::uuid AND org_id=$2::uuid`,
          [id, orgId],
        );
        if (sponsor.rowCount) {
          await client.query(
            `UPDATE sponsor_contacts SET is_primary=false WHERE sponsor_id=$1::uuid AND org_id=$2::uuid`,
            [sponsor.rows[0].sponsorId, orgId],
          );
        }
      }
      const result = await client.query(
        `UPDATE sponsor_contacts SET name=$1, title=$2, email=$3, phone=$4, is_primary=$5, notes=$6, updated_at=now()
         WHERE id=$7::uuid AND org_id=$8::uuid
         RETURNING id, sponsor_id AS "sponsorId", name, title, email, phone, is_primary AS "isPrimary", notes`,
        [name, body.title || null, body.email || null, body.phone || null, Boolean(body.isPrimary), body.notes || null, id, orgId],
      );
      if (!result.rowCount) throw new Error("Sponsor contact not found");
      return result.rows[0];
    });
    return Response.json({ success: true, contact });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor contact request failed");
  }
}
