import {
  auth,
  emailNotificationsSetupStatus,
  getUserEmailPreferences,
  mergeInAppNotificationPrefs,
  updateUserEmailPreferences,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";

const inAppPrefsSchema = z.object({
  matchAlerts: z.boolean().optional(),
  scoutReminders: z.boolean().optional(),
  syncFailures: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
  todoAssigned: z.boolean().optional(),
  todoCompleted: z.boolean().optional(),
  dutyAssigned: z.boolean().optional(),
  calendarEvents: z.boolean().optional(),
});

const emailPrefsSchema = z.object({
  productUpdates: z.boolean().optional(),
  coachAssignments: z.boolean().optional(),
  coachTodos: z.boolean().optional(),
  coachPracticeReminders: z.boolean().optional(),
});

const putSchema = z.object({
  notificationPrefs: inAppPrefsSchema.optional(),
  emailPrefs: emailPrefsSchema.optional(),
  // Back-compat: bare email fields still accepted as emailPrefs.
  productUpdates: z.boolean().optional(),
  coachAssignments: z.boolean().optional(),
  coachTodos: z.boolean().optional(),
  coachPracticeReminders: z.boolean().optional(),
});

async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const data = await withRls({ userId: session.user.id }, async (client) => {
      const profile = await client.query<{ notificationPrefs: unknown }>(
        `SELECT notification_prefs AS "notificationPrefs" FROM profiles WHERE user_id = $1`,
        [session.user.id],
      );
      const emailPrefs = await getUserEmailPreferences(client, session.user.id);
      return {
        notificationPrefs: mergeInAppNotificationPrefs(profile.rows[0]?.notificationPrefs),
        emailPrefs,
      };
    });
    return Response.json({
      ...data,
      delivery: emailNotificationsSetupStatus(),
    });
  } catch {
    return Response.json({ error: "Could not load notification preferences." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = putSchema.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "Invalid notification preferences." }, { status: 400 });
  }

  const emailPatch =
    body.data.emailPrefs ??
    (body.data.productUpdates !== undefined ||
    body.data.coachAssignments !== undefined ||
    body.data.coachTodos !== undefined ||
    body.data.coachPracticeReminders !== undefined
      ? {
          productUpdates: body.data.productUpdates,
          coachAssignments: body.data.coachAssignments,
          coachTodos: body.data.coachTodos,
          coachPracticeReminders: body.data.coachPracticeReminders,
        }
      : undefined);

  try {
    const updated = await withRls({ userId: session.user.id }, async (client) => {
      let notificationPrefs = mergeInAppNotificationPrefs(null);
      if (body.data.notificationPrefs) {
        const existing = await client.query<{ notificationPrefs: unknown }>(
          `SELECT notification_prefs AS "notificationPrefs" FROM profiles WHERE user_id = $1`,
          [session.user.id],
        );
        notificationPrefs = {
          ...mergeInAppNotificationPrefs(existing.rows[0]?.notificationPrefs),
          ...body.data.notificationPrefs,
        };
        await client.query(
          `INSERT INTO profiles(user_id, notification_prefs)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (user_id) DO UPDATE SET notification_prefs = excluded.notification_prefs`,
          [session.user.id, JSON.stringify(notificationPrefs)],
        );
      } else {
        const existing = await client.query<{ notificationPrefs: unknown }>(
          `SELECT notification_prefs AS "notificationPrefs" FROM profiles WHERE user_id = $1`,
          [session.user.id],
        );
        notificationPrefs = mergeInAppNotificationPrefs(existing.rows[0]?.notificationPrefs);
      }

      const emailPrefs = emailPatch
        ? await updateUserEmailPreferences(client, session.user.id, emailPatch)
        : await getUserEmailPreferences(client, session.user.id);

      return { notificationPrefs, emailPrefs };
    });

    return Response.json({
      ok: true,
      ...updated,
      delivery: emailNotificationsSetupStatus(),
    });
  } catch {
    return Response.json({ error: "Could not save notification preferences." }, { status: 500 });
  }
}
