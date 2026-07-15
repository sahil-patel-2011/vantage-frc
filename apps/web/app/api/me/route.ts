import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ authenticated: false }, { status: 401 });

    const profile = await withRls({ userId: session.user.id }, async (client) => {
      const platform = await client.query(`SELECT 1 FROM platform_admins WHERE user_id=$1`, [session.user.id]);
      const membership = await client.query<{
        orgId: string;
        role: string;
        teamNumber: number | null;
        orgName: string | null;
      }>(
        `SELECT m.org_id AS "orgId", m.role, o.team_number AS "teamNumber", o.name AS "orgName"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id=$1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id],
      );
      const created = await client.query<{ createdAt: string | null }>(
        `SELECT created_at::text AS "createdAt" FROM users WHERE id=$1`,
        [session.user.id],
      );
      return {
        platformAdmin: Boolean(platform.rowCount),
        membership: membership.rows[0] ?? null,
        memberSince: created.rows[0]?.createdAt ?? null,
      };
    });

    return Response.json({
      authenticated: true,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      orgId: profile.membership?.orgId ?? null,
      teamNumber: profile.membership?.teamNumber ?? null,
      orgName: profile.membership?.orgName ?? null,
      role: profile.membership?.role ?? null,
      platformAdmin: profile.platformAdmin,
      memberSince: profile.memberSince,
    });
  } catch {
    return Response.json({ authenticated: false }, { status: 401 });
  }
}
