import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { teamAdminShellCopy, teamAdminSetupSteps } from "../../../lib/team/team-admin-related";
import TeamAdminClient from "../team-admin-client";
import "../team-admin.css";

export const metadata = {
  title: "Team admin",
  description: "Invite people and choose what each person can open.",
};

/**
 * Team admin is people and invites only. Team profile and branding live on
 * /team/admin/profile, access presets on /team/admin/presets, and GitHub on
 * /connectors/github.
 */
export default async function TeamAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = teamAdminShellCopy("setup");
    const setup = teamAdminSetupSteps(null)[0];
    return (
      <main className="module-page team-admin-page soft-gate">
        <PageHeader
          breadcrumbs="Team / Admin"
          title="Team admin"
          description="Invite people and choose what each person can open. People without an invite go to the waitlist."
        />
        <EmptyState
          soft
          title={copy.title}
          description={copy.description}
          badge="Needs setup"
          badgeTone="setup"
        >
          <Button as="a" variant="primary" href={setup?.href ?? "/workspace"}>
            {setup?.label ?? "Choose your team"}
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <TeamAdminClient orgId={orgId} />;
}
