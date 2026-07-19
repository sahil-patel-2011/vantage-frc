import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  defaultIslandHrefs,
  isValidIslandSelection,
} from "../../../../lib/nav/island-preferences";

async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ tabs: defaultIslandHrefs(), persisted: false }, { status: 401 });

  const tabs = await withRls({ userId }, async (client) => {
    const result = await client.query<{ tabs: unknown }>(
      `SELECT island_tabs AS tabs FROM profiles WHERE user_id = $1`,
      [userId],
    );
    return isValidIslandSelection(result.rows[0]?.tabs)
      ? result.rows[0]!.tabs
      : defaultIslandHrefs();
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
