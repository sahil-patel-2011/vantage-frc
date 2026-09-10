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
    const row = await withRls({ userId }, async (client) => {
      const result = await client.query<{ theme: Theme | null; chosen: boolean }>(
        "SELECT theme_preference AS theme, theme_chosen_at IS NOT NULL AS chosen FROM profiles WHERE user_id=$1",
        [userId],
      );
      return result.rows[0] ?? null;
    });
    // `persisted` must mean "this person chose it". The column is NOT NULL
    // DEFAULT 'light', so the value alone cannot say that; theme_chosen_at
    // (0650) can. Reporting the default as persisted made ThemeProvider treat
    // "light" as the account's decision and overwrite a Dark or System choice
    // made on the device — every load, until the person happened to open
    // Account › Appearance.
    const theme: Theme = row?.theme === "dark" ? "dark" : "light";
    return Response.json({ theme, persisted: Boolean(row?.chosen) });
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
        `INSERT INTO profiles(user_id,theme_preference,theme_chosen_at)
         VALUES($1,$2,now())
         ON CONFLICT(user_id) DO UPDATE SET theme_preference=excluded.theme_preference, theme_chosen_at=now()`,
        [userId, body.theme],
      );
    });
    return Response.json({ theme: body.theme, persisted: true });
  } catch {
    return Response.json({ theme: body.theme, persisted: false });
  }
}
