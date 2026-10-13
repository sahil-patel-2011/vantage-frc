import { PageHeader } from "../../../../components/ui";
import { withOrgHref } from "../../../../lib/nav/product-nav";
import { TeamDeletePanel, TeamLifecyclePanel } from "../team-lifecycle-panel";
import { ResolveTeamProfile } from "./resolve-team";
import "../../team-admin.css";
import { TeamSettingsNav } from "../../../../components/team-settings-nav";
import { teamSettingsBreadcrumb } from "../../../../lib/nav/team-settings-nav";

export const metadata = {
  title: "Team profile",
  description: "Team identity and lifecycle.",
};

/** Team lifecycle; sponsor and grant facts live in the shared team background. */
export default async function TeamProfileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader breadcrumbs={teamSettingsBreadcrumb("profile")} title="Team profile" />
        <ResolveTeamProfile />
      </main>
    );
  }
  return (
    <main className="module-page team-admin-page team-profile-settings">
      <PageHeader
        breadcrumbs={teamSettingsBreadcrumb("profile")}
        title="Team profile"
        description="Team identity and lifecycle. Your team background supplies sponsor and grant drafts."
      >
        <TeamSettingsNav orgId={orgId} current="profile" />
      </PageHeader>
      <TeamLifecyclePanel orgId={orgId} />
      <p className="app-muted"><a href={withOrgHref("/team/background", orgId)}>Edit team background</a> · The same team facts are used in sponsor proposals and grants.</p>
      <TeamDeletePanel orgId={orgId} />
    </main>
  );
}
