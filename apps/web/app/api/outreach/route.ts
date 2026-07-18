import { createEmailProvider } from "@vantage/core";
import { withRls } from "@vantage/db";
import { awardCatalogEntry } from "../../../lib/awards";
import { draftOutreachMessage, type OutreachKind } from "../../../lib/outreach";
import {
  requireGrantApplicationInOrg,
  requireOrgAdmin,
  requireOrgMember,
  requireSponsorInOrg,
  requireTenantSession,
  tenantErrorResponse,
} from "../../../lib/tenant-org-access";

const RETURNING = `id, sponsor_id AS "sponsorId", grant_application_id AS "grantApplicationId", kind, subject, body,
  status, generated_by AS "generatedBy", sent_at AS "sentAt", created_at AS "createdAt"`;

const VALID_KINDS = ["thank_you", "renewal_ask", "new_prospect_intro", "grant_followup", "custom"];

export async function GET(request: Request) {
  try {
    const current = await requireTenantSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const sponsorId = url.searchParams.get("sponsorId");
    if (!orgId) throw new Error("orgId is required");
    const conditions = ["org_id=$1::uuid"];
    const params: unknown[] = [orgId];
    if (sponsorId) {
      params.push(sponsorId);
      conditions.push(`sponsor_id=$${params.length}::uuid`);
    }
    const messages = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, current.user.id);
      if (sponsorId) await requireSponsorInOrg(client, orgId, sponsorId);
      const result = await client.query(
        `SELECT ${RETURNING} FROM outreach_messages WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
        params,
      );
      return result.rows;
    });
    return Response.json({ messages });
  } catch (error) {
    return tenantErrorResponse(error, "Outreach request failed");
  }
}

/** Builds a template draft from sponsor/grant/award history in the DB, then stores it. */
export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const kind = String(body.kind ?? "") as OutreachKind;
    if (!orgId) throw new Error("orgId is required");
    if (!VALID_KINDS.includes(kind)) throw new Error("Invalid outreach kind");
    const sponsorId = body.sponsorId ? String(body.sponsorId) : null;
    const grantApplicationId = body.grantApplicationId ? String(body.grantApplicationId) : null;
    const message = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      if (sponsorId) await requireSponsorInOrg(client, orgId, sponsorId);
      if (grantApplicationId) await requireGrantApplicationInOrg(client, orgId, grantApplicationId);

      const org = await client.query(
        `SELECT name, team_number AS "teamNumber" FROM organizations WHERE id=$1::uuid`,
        [orgId],
      );
      const seasonYear = new Date().getFullYear();

      let sponsor: { name: string; contactName: string | null } | undefined;
      let contributionSummary: { totalUsd: number } | undefined;
      if (sponsorId) {
        const sponsorRow = await client.query(
          `SELECT name FROM sponsors WHERE id=$1::uuid AND org_id=$2::uuid`,
          [sponsorId, orgId],
        );
        const contact = await client.query(
          `SELECT name FROM sponsor_contacts WHERE sponsor_id=$1::uuid ORDER BY is_primary DESC, name LIMIT 1`,
          [sponsorId],
        );
        sponsor = { name: sponsorRow.rows[0].name, contactName: contact.rows[0]?.name ?? null };
        const totals = await client.query(
          `SELECT COALESCE(sum(amount_usd),0)::text AS total FROM sponsor_contributions WHERE sponsor_id=$1::uuid AND type='cash'`,
          [sponsorId],
        );
        contributionSummary = { totalUsd: Number(totals.rows[0].total) };
      }

      let grant: { name: string; funder: string | null; amountRequestedUsd: number | null } | undefined;
      if (grantApplicationId) {
        const grantRow = await client.query(
          `SELECT go.name, go.funder, ga.amount_requested_usd AS "amountRequestedUsd"
           FROM grant_applications ga LEFT JOIN grant_opportunities go ON go.id = ga.grant_opportunity_id
           WHERE ga.id=$1::uuid AND ga.org_id=$2::uuid`,
          [grantApplicationId, orgId],
        );
        grant = {
          name: grantRow.rows[0].name ?? "Grant application",
          funder: grantRow.rows[0].funder,
          amountRequestedUsd:
            grantRow.rows[0].amountRequestedUsd != null ? Number(grantRow.rows[0].amountRequestedUsd) : null,
        };
      }

      let awardHighlights: string[] | undefined;
      if (kind === "thank_you") {
        const wins = await client.query(
          `SELECT award_type AS "awardType" FROM award_submissions WHERE org_id=$1::uuid AND season_year=$2 AND status='won'`,
          [orgId, seasonYear],
        );
        if (wins.rowCount) {
          awardHighlights = wins.rows.map(
            (w: { awardType: string }) => `won the ${awardCatalogEntry(w.awardType)?.name ?? w.awardType}`,
          );
        }
      }

      const draft = draftOutreachMessage(kind, {
        teamName: org.rows[0]?.name ?? "our team",
        teamNumber: org.rows[0]?.teamNumber ?? null,
        seasonYear,
        senderName: current.user.name,
        sponsor,
        contributionSummary,
        grant,
        awardHighlights,
      });

      const subject = (typeof body.subject === "string" && body.subject.trim()) || draft.subject;
      const text = (typeof body.body === "string" && body.body.trim()) || draft.body;

      const result = await client.query(
        `INSERT INTO outreach_messages(org_id, sponsor_id, grant_application_id, kind, subject, body, generated_by, created_by)
         VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,'template',$7::uuid)
         RETURNING ${RETURNING}`,
        [orgId, sponsorId, grantApplicationId, kind, subject, text, current.user.id],
      );
      return result.rows[0];
    });
    return Response.json({ message });
  } catch (error) {
    return tenantErrorResponse(error, "Outreach request failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    const action = String(body.action ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const message = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);

      if (action === "send") {
        const to = body.to ? String(body.to) : "";
        if (!to) throw new Error("Recipient email is required to send");
        const existing = await client.query(
          `SELECT subject, body, status, sponsor_id AS "sponsorId" FROM outreach_messages WHERE id=$1::uuid AND org_id=$2::uuid`,
          [id, orgId],
        );
        if (!existing.rowCount) throw new Error("Outreach message not found");
        if (existing.rows[0].status === "sent") throw new Error("This message has already been sent");
        const subject =
          typeof body.subject === "string" && body.subject.trim() ? body.subject : existing.rows[0].subject;
        const text = typeof body.body === "string" && body.body.trim() ? body.body : existing.rows[0].body;
        const provider = createEmailProvider();
        await provider.sendFreeform({ to, subject, text });
        const result = await client.query(
          `UPDATE outreach_messages SET subject=$1, body=$2, status='sent', sent_at=now(), updated_at=now()
           WHERE id=$3::uuid AND org_id=$4::uuid RETURNING ${RETURNING}`,
          [subject, text, id, orgId],
        );
        if (existing.rows[0].sponsorId) {
          await client.query(
            `UPDATE sponsors SET status='active' WHERE id=$1::uuid AND org_id=$2::uuid AND status='prospect'`,
            [existing.rows[0].sponsorId, orgId],
          );
        }
        return result.rows[0];
      }

      const result = await client.query(
        `UPDATE outreach_messages SET subject=COALESCE($1,subject), body=COALESCE($2,body), updated_at=now()
         WHERE id=$3::uuid AND org_id=$4::uuid AND status='draft' RETURNING ${RETURNING}`,
        [body.subject ?? null, body.body ?? null, id, orgId],
      );
      if (!result.rowCount) throw new Error("Outreach message not found or already sent");
      return result.rows[0];
    });
    return Response.json({ success: true, message });
  } catch (error) {
    return tenantErrorResponse(error, "Outreach request failed");
  }
}
