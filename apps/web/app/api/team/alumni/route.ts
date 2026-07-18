import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Team alumni network: a shared per-team directory. Any member can read and add
// alumni; RLS lets admins (or the original adder) delete. Stored per org.

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Alumni request failed" }, { status: 400 });

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
      const alumni = await client.query(
        `SELECT id, full_name AS "fullName", grad_year AS "gradYear", current_role AS "currentRole",
                email, discord_handle AS "discordHandle", linkedin_url AS "linkedinUrl", note,
                added_by AS "addedBy", created_at AS "createdAt"
         FROM team_alumni WHERE org_id=$1
         ORDER BY grad_year DESC NULLS LAST, full_name ASC`,
        [orgId],
      );
      return { alumni: alumni.rows, viewerId: current.user.id };
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
      fullName?: string;
      gradYear?: number | string;
      currentRole?: string;
      email?: string;
      discordHandle?: string;
      linkedinUrl?: string;
      note?: string;
    };
    if (!body.orgId) throw new Error("orgId is required");
    if (!body.fullName?.trim()) throw new Error("Name is required");
    const orgId = body.orgId;
    const gradYear = body.gradYear ? Number(body.gradYear) : null;
    if (gradYear !== null && (!Number.isInteger(gradYear) || gradYear < 1990 || gradYear > 2100)) {
      throw new Error("Graduation year looks invalid");
    }
    const id = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        orgId,
        current.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
      const result = await client.query<{ id: string }>(
        `INSERT INTO team_alumni(org_id, full_name, grad_year, current_role, email, discord_handle, linkedin_url, note, added_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          orgId,
          body.fullName.trim(),
          gradYear,
          body.currentRole?.trim() || null,
          body.email?.trim() || null,
          body.discordHandle?.trim() || null,
          body.linkedinUrl?.trim() || null,
          body.note?.trim() || null,
          current.user.id,
        ],
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
      // RLS enforces admin-or-adder; report if nothing was removed.
      const result = await client.query(`DELETE FROM team_alumni WHERE id=$1 AND org_id=$2`, [id, orgId]);
      if (!result.rowCount) throw new Error("Not allowed to remove this entry");
    });
    return Response.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
