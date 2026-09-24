import { EmptyState, PageHeader, Button } from "../../../../components/ui";
import { withOrgHref } from "../../../../lib/nav/product-nav";
import { RoleProfilesPanel } from "../../role-profiles-panel";
import "../../team-admin.css";

export const metadata = {
  title: "Access presets",
  description: "Name a job once, like Drive coach, and give it to someone in one click.",
};

/** Role profiles, renamed "Access presets". People pick one from their Access panel on Team admin. */
export default async function AccessPresetsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader breadcrumbs="Team / Admin / Presets" title="Access presets" />
        <EmptyState soft badge="Needs setup" badgeTone="setup" title="Choose your team" description="Presets belong to one team.">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return (
    <main className="module-page team-admin-page">
      <PageHeader
        breadcrumbs="Team / Admin / Presets"
        title="Access presets"
        description="Name a job once, like Drive coach, then give it to someone from their Access panel on Team admin."
      >
        <nav className="team-admin-settings-links" aria-label="Team settings">
          <a href={withOrgHref("/team/admin", orgId)}>‹ Team admin</a>
        </nav>
      </PageHeader>
      <RoleProfilesPanel orgId={orgId} />
    </main>
  );
}
