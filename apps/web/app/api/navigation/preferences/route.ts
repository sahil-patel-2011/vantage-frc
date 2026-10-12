import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { defaultPinHrefs } from "../../../../lib/nav/pins";
import { readPins, savePins } from "../../../../lib/nav/pins-store";

/**
 * "Your apps": the places a person pins (bottom bar, the menu's top row, the sidebar's Pinned
 * group). `tabs` is the whole ordered list; the bottom bar shows the first four. The name stays
 * `tabs` so a saved bar from before pins keeps working.
 */
async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ tabs: defaultPinHrefs(), isDefault: true, persisted: false }, { status: 401 });

  const view = await withRls({ userId }, (client) => readPins(client, userId));
  return Response.json({ ...view, persisted: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { tabs?: unknown; reset?: unknown } | null;
  const result = await withRls({ userId }, (client) => savePins(client, userId, body ?? {}));
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({ ...result.view, persisted: true }, { headers: { "Cache-Control": "no-store" } });
}
