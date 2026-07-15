import { assertPlatformAdmin, assertPlatformPrivilegeMfa, auth, createOrganizationAsPlatformAdmin, platformAdminDeniedResponse } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

export async function GET() {
  try {
    const current = await session();
    const organizations = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      return (
        await client.query(
          `SELECT o.id,o.name,o.slug,o.team_number AS "teamNumber",o.created_at AS "createdAt",
            u.email AS "ownerEmail"
           FROM organizations o LEFT JOIN memberships m ON m.org_id=o.id AND m.role='owner'
           LEFT JOIN users u ON u.id=m.user_id ORDER BY o.team_number`,
        )
      ).rows;
    });
    return Response.json({ organizations });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as {
      name?: string;
      slug?: string;
      teamNumber?: number;
      ownerEmail?: string;
    };
    if (!body.name || !body.slug || !body.ownerEmail)
      return Response.json({ error: "All organization fields are required" }, { status: 400 });
    const id = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, { userId: current.user.id, sessionId: current.session.id });
      return createOrganizationAsPlatformAdmin(client, current.user.id, {
        name: body.name!,
        slug: body.slug!,
        teamNumber: Number(body.teamNumber),
        ownerEmail: body.ownerEmail!,
      });
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
