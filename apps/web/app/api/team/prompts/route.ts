import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Team AI Prompt Library: shared, reusable prompts. Any member reads and adds;
// admins or the author remove. Stored per org.

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Prompt request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        orgId,
        current.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
      const prompts = await client.query(
        `SELECT id, title, category, body, created_by AS "createdBy", updated_at AS "updatedAt"
         FROM team_prompt_templates WHERE org_id=$1
         ORDER BY category ASC, updated_at DESC`,
        [orgId],
      );
      return { prompts: prompts.rows, viewerId: current.user.id };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as {
      orgId?: string;
      title?: string;
      category?: string;
      body?: string;
    };
    if (!body.orgId) throw new Error("orgId is required");
    const title = body.title?.trim();
    const text = body.body?.trim();
    if (!title || !text) throw new Error("Title and prompt body are required");
    const orgId = body.orgId;
    const id = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        orgId,
        current.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
      const result = await client.query<{ id: string }>(
        `INSERT INTO team_prompt_templates(org_id, title, category, body, created_by)
         VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [orgId, title, body.category?.trim() || "general", text, current.user.id],
      );
      return result.rows[0]!.id;
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const id = url.searchParams.get("id");
    if (!orgId || !id) throw new Error("orgId and id are required");
    await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(`DELETE FROM team_prompt_templates WHERE id=$1 AND org_id=$2`, [
        id,
        orgId,
      ]);
      if (!result.rowCount) throw new Error("Not allowed to remove this prompt");
    });
    return Response.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
