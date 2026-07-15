import { auth, createOrganizationAsPlatformAdmin } from "@vantage/core";
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
      const allowed = await client.query("SELECT is_platform_admin() AS value");
      if (!allowed.rows[0]?.value) throw new Error("Platform administrator access required");
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
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 403 });
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
    const id = await withRls({ userId: current.user.id }, (client) =>
      createOrganizationAsPlatformAdmin(client, current.user.id, {
        name: body.name!,
        slug: body.slug!,
        teamNumber: Number(body.teamNumber),
        ownerEmail: body.ownerEmail!,
      }),
    );
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 403 });
  }
}
