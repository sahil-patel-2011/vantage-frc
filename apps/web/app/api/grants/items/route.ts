import { withRls } from "@vantage/db";
import {
  requireGrantApplicationInOrg,
  requireOrgAdmin,
  requireOrgMember,
  requireTenantSession,
  tenantErrorResponse,
} from "../../../../lib/tenant-org-access";

const RETURNING = `id, application_id AS "applicationId", kind, prompt, content, char_limit AS "charLimit",
  done, assignee_user_id AS "assigneeUserId", due_at AS "dueAt", sort_order AS "sortOrder"`;

export async function GET(request: Request) {
  try {
    const current = await requireTenantSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const applicationId = url.searchParams.get("applicationId");
    if (!orgId || !applicationId) throw new Error("orgId and applicationId are required");
    const items = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, current.user.id);
      await requireGrantApplicationInOrg(client, orgId, applicationId);
      const result = await client.query(
        `SELECT ${RETURNING} FROM grant_application_items WHERE org_id=$1::uuid AND application_id=$2::uuid ORDER BY sort_order`,
        [orgId, applicationId],
      );
      return result.rows;
    });
    return Response.json({ items });
  } catch (error) {
    return tenantErrorResponse(error, "Grant item request failed");
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const applicationId = String(body.applicationId ?? "");
    const kind = String(body.kind ?? "");
    if (!orgId || !applicationId) throw new Error("orgId and applicationId are required");
    if (!["question", "essay", "attachment"].includes(kind)) throw new Error("Invalid item kind");
    const item = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      await requireGrantApplicationInOrg(client, orgId, applicationId);
      const order = await client.query(
        `SELECT COALESCE(max(sort_order),-1)+1 AS next FROM grant_application_items WHERE application_id=$1::uuid AND org_id=$2::uuid`,
        [applicationId, orgId],
      );
      const result = await client.query(
        `INSERT INTO grant_application_items(application_id, org_id, kind, prompt, content, char_limit, assignee_user_id, due_at, sort_order)
         VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9)
         RETURNING ${RETURNING}`,
        [
          applicationId, orgId, kind, body.prompt || null, body.content || null, body.charLimit || null,
          body.assigneeUserId || null, body.dueAt || null, order.rows[0].next,
        ],
      );
      return result.rows[0];
    });
    return Response.json({ item });
  } catch (error) {
    return tenantErrorResponse(error, "Grant item request failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const item = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      const result = await client.query(
        `UPDATE grant_application_items SET
           content=COALESCE($1,content), done=COALESCE($2,done), assignee_user_id=COALESCE($3,assignee_user_id),
           due_at=COALESCE($4,due_at), updated_at=now()
         WHERE id=$5::uuid AND org_id=$6::uuid RETURNING ${RETURNING}`,
        [body.content ?? null, body.done ?? null, body.assigneeUserId ?? null, body.dueAt ?? null, id, orgId],
      );
      if (!result.rowCount) throw new Error("Grant item not found");
      return result.rows[0];
    });
    return Response.json({ success: true, item });
  } catch (error) {
    return tenantErrorResponse(error, "Grant item request failed");
  }
}
