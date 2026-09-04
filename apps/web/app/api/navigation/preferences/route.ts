import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  defaultIslandHrefs,
  isDefaultIslandSelection,
  isValidIslandSelection,
} from "../../../../lib/nav/island-preferences";
import { personalizeFromRoles } from "../../../../lib/onboarding/personalize";

async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ tabs: defaultIslandHrefs(), persisted: false }, { status: 401 });

  const tabs = await withRls({ userId }, async (client) => {
    const result = await client.query<{
      tabs: unknown;
      teamRole: string | null;
      crewRole: string | null;
      primaryFocus: string | null;
    }>(
      `SELECT island_tabs AS tabs,
              team_role AS "teamRole",
              crew_role AS "crewRole",
              primary_focus AS "primaryFocus"
       FROM profiles WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    const current = row?.tabs;
    if (isValidIslandSelection(current) && !isDefaultIslandSelection(current)) return current;
    const personalized = personalizeFromRoles({
      teamRole: row?.teamRole,
      crewRole: row?.crewRole,
      primaryFocus: row?.primaryFocus,
    });
    const same =
      isValidIslandSelection(current) &&
      current.every((href, index) => href === personalized.islandHrefs[index]);
    if (!same && (row?.teamRole || row?.crewRole)) {
      await client.query(
        `INSERT INTO profiles(user_id, island_tabs)
         VALUES($1, $2::jsonb)
         ON CONFLICT(user_id) DO UPDATE SET island_tabs = excluded.island_tabs`,
        [userId, JSON.stringify(personalized.islandHrefs)],
      );
    }
    return personalized.islandHrefs;
  });

  return Response.json({ tabs, persisted: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null) as { tabs?: unknown } | null;
  if (!isValidIslandSelection(body?.tabs)) {
    return Response.json(
      { error: "Choose exactly four unique apps from the island catalog." },
      { status: 400 },
    );
  }

  await withRls({ userId }, async (client) => {
    await client.query(
      `INSERT INTO profiles(user_id, island_tabs)
       VALUES($1, $2::jsonb)
       ON CONFLICT(user_id) DO UPDATE SET island_tabs = excluded.island_tabs`,
      [userId, JSON.stringify(body.tabs)],
    );
  });

  return Response.json(
    { tabs: body.tabs, persisted: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
