import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Award item request failed" }, { status: 400 });

const RETURNING = `id, submission_id AS "submissionId", kind, prompt, content, char_limit AS "charLimit",
  done, assignee_user_id AS "assigneeUserId", due_at AS "dueAt", sort_order AS "sortOrder"`;

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const submissionId = url.searchParams.get("submissionId");
    if (!orgId || !submissionId) throw new Error("orgId and submissionId are required");
    const items = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT ${RETURNING} FROM award_items WHERE org_id=$1 AND submission_id=$2 ORDER BY sort_order`,
        [orgId, submissionId],
      );
      return result.rows;
    });
    return Response.json({ items });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const submissionId = String(body.submissionId ?? "");
    const kind = String(body.kind ?? "");
    if (!orgId || !submissionId) throw new Error("orgId and submissionId are required");
    if (!["essay", "task", "question"].includes(kind)) throw new Error("Invalid item kind");
    const item = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const order = await client.query(
        `SELECT COALESCE(max(sort_order),-1)+1 AS next FROM award_items WHERE submission_id=$1`,
        [submissionId],
      );
      const result = await client.query(
        `INSERT INTO award_items(submission_id, org_id, kind, prompt, content, char_limit, assignee_user_id, due_at, sort_order)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING ${RETURNING}`,
        [submissionId, orgId, kind, body.prompt || null, body.content || null, body.charLimit || null,
          body.assigneeUserId || null, body.dueAt || null, order.rows[0].next],
      );
      return result.rows[0];
    });
    return Response.json({ item });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const item = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `UPDATE award_items SET
           content=COALESCE($1,content), done=COALESCE($2,done), assignee_user_id=COALESCE($3,assignee_user_id),
           due_at=COALESCE($4,due_at), updated_at=now()
         WHERE id=$5 AND org_id=$6 RETURNING ${RETURNING}`,
        [body.content ?? null, body.done ?? null, body.assigneeUserId ?? null, body.dueAt ?? null, id, orgId],
      );
      if (!result.rowCount) throw new Error("Award item not found");
      return result.rows[0];
    });
    return Response.json({ success: true, item });
  } catch (error) { return fail(error); }
}
