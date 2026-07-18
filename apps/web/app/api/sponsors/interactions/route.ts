import { withRls } from "@vantage/db";
import {
  requireOrgAdmin,
  requireOrgMember,
  requireSponsorInOrg,
  requireTenantSession,
  tenantErrorResponse,
} from "../../../../lib/tenant-org-access";

const VALID_TYPES = ["email", "call", "meeting", "visit", "event_invite", "thank_you", "other"] as const;

export async function GET(request: Request) {
  try {
    const current = await requireTenantSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const sponsorId = url.searchParams.get("sponsorId");
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    const interactions = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, current.user.id);
      await requireSponsorInOrg(client, orgId, sponsorId);
      const result = await client.query(
        `SELECT i.id, i.sponsor_id AS "sponsorId", i.type, i.subject, i.notes, i.occurred_at AS "occurredAt",
                i.logged_by AS "loggedBy", u.name AS "loggedByName"
         FROM sponsor_interactions i JOIN users u ON u.id = i.logged_by
         WHERE i.org_id=$1::uuid AND i.sponsor_id=$2::uuid ORDER BY i.occurred_at DESC`,
        [orgId, sponsorId],
      );
      return result.rows;
    });
    return Response.json({ interactions });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor interaction request failed");
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const sponsorId = String(body.sponsorId ?? "");
    const type = String(body.type ?? "");
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    if (!(VALID_TYPES as readonly string[]).includes(type)) throw new Error("Invalid interaction type");
    const interaction = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      await requireSponsorInOrg(client, orgId, sponsorId);
      const result = await client.query(
        `INSERT INTO sponsor_interactions(sponsor_id, org_id, type, subject, notes, occurred_at, logged_by)
         VALUES($1::uuid,$2::uuid,$3,$4,$5,COALESCE($6,now()),$7::uuid)
         RETURNING id, sponsor_id AS "sponsorId", type, subject, notes, occurred_at AS "occurredAt", logged_by AS "loggedBy"`,
        [sponsorId, orgId, type, body.subject || null, body.notes || null, body.occurredAt || null, current.user.id],
      );
      return result.rows[0];
    });
    return Response.json({ interaction });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor interaction request failed");
  }
}
