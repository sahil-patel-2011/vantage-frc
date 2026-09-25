import { PageHeader } from "../../../../components/ui";
import { TeamBrandingPanel } from "../../../../lib/branding/team-branding-panel";
import { withOrgHref } from "../../../../lib/nav/product-nav";
import { TeamProfilePanel } from "../../team-profile-panel";
import { ResolveTeamProfile } from "./resolve-team";
import "../../team-admin.css";

export const metadata = {
  title: "Team profile",
  description: "Where your team is, what it does, and its colours and logo.",
};

/** Team profile and branding — moved off Team admin so that page is only people and invites. */
export default async function TeamProfileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader breadcrumbs="Team / Admin / Profile" title="Team profile" />
        <ResolveTeamProfile />
      </main>
    );
  }
  return (
    <main className="module-page team-admin-page team-profile-settings">
      <PageHeader
        breadcrumbs="Team / Admin / Profile"
        title="Team profile"
        description="Where your team is, what it does, and its colours and logo."
      >
        <nav className="team-admin-settings-links" aria-label="Team settings">
          <a href={withOrgHref("/team/admin", orgId)}>‹ Team admin</a>
          <a href={withOrgHref("/team/background", orgId)}>History and numbers for sponsors</a>
        </nav>
      </PageHeader>
      <TeamProfilePanel orgId={orgId} />
      <TeamBrandingPanel orgId={orgId} />
    </main>
  );
}
