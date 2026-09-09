import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { DEFAULT_COCKPIT_PREFS, saveCockpitPrefs } from "../../../../lib/cockpit/prefs";
import { loadCockpitPrefs } from "../../../../lib/cockpit/load-prefs";

export const dynamic = "force-dynamic";

async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json(
      { cockpit: { ...DEFAULT_COCKPIT_PREFS }, persisted: false },
      { status: 401 },
    );
  }

  try {
    const cockpit = await withRls({ userId }, (client) => loadCockpitPrefs(client, userId));
    return Response.json({ cockpit, persisted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ cockpit: { ...DEFAULT_COCKPIT_PREFS }, persisted: false });
  }
}

export async function PUT(request: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { cockpit?: unknown } | null;

  try {
    const cockpit = await withRls({ userId }, (client) =>
      saveCockpitPrefs(client, userId, body?.cockpit),
    );
    return Response.json({ cockpit, persisted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not save cockpit preferences right now." }, { status: 500 });
  }
}
