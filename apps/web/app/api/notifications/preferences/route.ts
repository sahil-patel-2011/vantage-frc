import {
  auth,
  emailNotificationsSetupStatus,
  getUserEmailPreferences,
  mergeInAppNotificationPrefs,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Read-only. `/api/account` (PUT) is the single writer for profiles.notification_prefs and
// user email preferences — two writers with different shapes silently clobbered each other.

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
