import { loadMeProfile } from "../api/me/route";
import { SettingsHome } from "../../components/settings-layout";
import { withPagePaint } from "../../lib/page-org";

export const metadata = {
  title: "Settings",
};

export const dynamic = "force-dynamic";

/** One place for settings: You, then This team (what your role allows). */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const session = await withPagePaint("/settings", orgId, async ({ client, userId, email, name, orgId: resolved }) => {
    const profile = await loadMeProfile(client, userId, resolved);
    const displayName = profile.profile?.displayName?.trim() || name;
    return {
      authenticated: true,
      userId,
      name: displayName,
      displayName,
      email,
      orgId: profile.membership?.orgId ?? resolved,
      teamNumber: profile.membership?.teamNumber ?? profile.profile?.preferredTeamNumber ?? null,
      orgName: profile.membership?.orgName ?? null,
      role: profile.membership?.role ?? null,
      memberships: profile.memberships,
      platformAdmin: profile.platformAdmin,
      unreadNotificationCount: profile.unreadNotificationCount,
    };
  });
  return <SettingsHome initialSession={session} />;
}
