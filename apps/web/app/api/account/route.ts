import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";

const prefsSchema = z.object({
  matchAlerts: z.boolean().optional(),
  scoutReminders: z.boolean().optional(),
  syncFailures: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
});

const putSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  notificationPrefs: prefsSchema.optional(),
});

export type NotificationPrefs = {
  matchAlerts: boolean;
  scoutReminders: boolean;
  syncFailures: boolean;
  productUpdates: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  matchAlerts: true,
  scoutReminders: true,
  syncFailures: true,
  productUpdates: false,
};

function mergePrefs(raw: unknown): NotificationPrefs {
  const parsed = prefsSchema.safeParse(raw ?? {});
  return { ...DEFAULT_PREFS, ...(parsed.success ? parsed.data : {}) };
}

async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const profile = await withRls({ userId: session.user.id }, async (client) => {
      const result = await client.query<{
        displayName: string | null;
        notificationPrefs: unknown;
        themePreference: string;
      }>(
        `SELECT display_name AS "displayName",
                notification_prefs AS "notificationPrefs",
                theme_preference AS "themePreference"
         FROM profiles WHERE user_id=$1`,
        [session.user.id],
      );
      const unread = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications
         WHERE user_id=$1 AND read_at IS NULL`,
        [session.user.id],
      );
      return {
        row: result.rows[0] ?? null,
        unreadCount: Number(unread.rows[0]?.count ?? 0),
      };
    });

    return Response.json({
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      displayName: profile.row?.displayName ?? session.user.name ?? null,
      themePreference: profile.row?.themePreference === "dark" ? "dark" : "light",
      notificationPrefs: mergePrefs(profile.row?.notificationPrefs),
      unreadNotificationCount: profile.unreadCount,
      googleConnected: false,
      tbaConfigured: Boolean(process.env.TBA_AUTH_KEY?.trim()),
      integrations: {
        google: {
          status: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "available" : "setup_required",
          detail: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ? "Google sign-in is configured for this deployment."
            : "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on this deployment.",
        },
        tba: {
          status: process.env.TBA_AUTH_KEY?.trim() ? "available" : "setup_required",
          detail: process.env.TBA_AUTH_KEY?.trim()
            ? "Platform TBA Read API key is configured for reference ingest."
            : "TBA_AUTH_KEY is not configured. Connect TBA in Admin → Data connectors or set the platform env key.",
        },
      },
    });
  } catch {
    return Response.json({ error: "Could not load account settings." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = putSchema.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "Invalid account update." }, { status: 400 });
  }

  try {
    const updated = await withRls({ userId: session.user.id }, async (client) => {
      const existing = await client.query<{ notificationPrefs: unknown; displayName: string | null }>(
        `SELECT notification_prefs AS "notificationPrefs", display_name AS "displayName"
         FROM profiles WHERE user_id=$1`,
        [session.user.id],
      );
      const nextPrefs = body.data.notificationPrefs
        ? { ...mergePrefs(existing.rows[0]?.notificationPrefs), ...body.data.notificationPrefs }
        : mergePrefs(existing.rows[0]?.notificationPrefs);
      const displayName = body.data.displayName ?? existing.rows[0]?.displayName ?? session.user.name ?? null;

      await client.query(
        `INSERT INTO profiles(user_id, display_name, notification_prefs)
         VALUES($1,$2,$3::jsonb)
         ON CONFLICT(user_id) DO UPDATE SET
           display_name = COALESCE(excluded.display_name, profiles.display_name),
           notification_prefs = excluded.notification_prefs`,
        [session.user.id, displayName, JSON.stringify(nextPrefs)],
      );

      if (body.data.displayName) {
        await client.query(`UPDATE users SET name=$2 WHERE id=$1`, [session.user.id, body.data.displayName]);
      }

      return { displayName, notificationPrefs: nextPrefs };
    });

    return Response.json({ ok: true, ...updated });
  } catch {
    return Response.json({ error: "Could not save account settings." }, { status: 500 });
  }
}
