import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEFAULT_APPEARANCE_PREFS,
  parseAppearancePrefs,
} from "../../../../lib/branding/appearance";

export const dynamic = "force-dynamic";

// Single writer for profiles.appearance_prefs. /api/account owns
// profiles.notification_prefs; both upserts are column-scoped so neither clobbers
// the other's column on the shared profiles row.

async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json(
      { appearance: { ...DEFAULT_APPEARANCE_PREFS }, persisted: false },
      { status: 401 },
    );
  }

  try {
    const appearance = await withRls({ userId }, async (client) => {
      const result = await client.query<{ appearancePrefs: unknown }>(
        `SELECT appearance_prefs AS "appearancePrefs" FROM profiles WHERE user_id = $1::uuid`,
        [userId],
      );
      return parseAppearancePrefs(result.rows[0]?.appearancePrefs);
    });
    return Response.json({ appearance, persisted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ appearance: { ...DEFAULT_APPEARANCE_PREFS }, persisted: false });
  }
}

export async function PUT(request: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { appearance?: unknown } | null;
  // parseAppearancePrefs is the validator: unknown keys and bad values fall back
  // to the default rather than reaching the column.
  const appearance = parseAppearancePrefs(body?.appearance);

  try {
    await withRls({ userId }, async (client) => {
      await client.query(
        `INSERT INTO profiles(user_id, appearance_prefs)
         VALUES ($1::uuid, $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET appearance_prefs = excluded.appearance_prefs`,
        [userId, JSON.stringify(appearance)],
      );
    });
  } catch {
    return Response.json(
      { error: "Could not save appearance preferences right now." },
      { status: 500 },
    );
  }

  return Response.json({ appearance, persisted: true }, { headers: { "Cache-Control": "no-store" } });
}
