import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

type Theme = "light" | "dark";

async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ theme: "light", persisted: false });

  try {
    const theme = await withRls({ userId }, async (client) => {
      const result = await client.query<{ theme: Theme | null }>(
        "SELECT theme_preference AS theme FROM profiles WHERE user_id=$1",
        [userId],
      );
      return result.rows[0]?.theme ?? "light";
    });
    return Response.json({ theme, persisted: true });
  } catch {
    return Response.json({ theme: "light", persisted: false });
  }
}

export async function PUT(request: Request) {
  const body = await request.json() as { theme?: Theme };
  if (body.theme !== "light" && body.theme !== "dark") {
    return Response.json({ error: "Theme must be light or dark." }, { status: 400 });
  }

  const userId = await currentUserId();
  if (!userId) return Response.json({ theme: body.theme, persisted: false });

  try {
    await withRls({ userId }, async (client) => {
      await client.query(
        `INSERT INTO profiles(user_id,theme_preference)
         VALUES($1,$2)
         ON CONFLICT(user_id) DO UPDATE SET theme_preference=excluded.theme_preference`,
        [userId, body.theme],
      );
    });
    return Response.json({ theme: body.theme, persisted: true });
  } catch {
    return Response.json({ theme: body.theme, persisted: false });
  }
}
