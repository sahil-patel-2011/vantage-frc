import { EmptyState, PageHeader } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import TeamAdminClient from "./team-admin-client";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Admin"
          title="Team admin"
          description="Membership, invites, and provider settings are org-scoped. Choose a team workspace to continue."
        />
        <TeamOpsNav active="admin" />
        <EmptyState title="Select a workspace" description="Open a team workspace to manage membership and integrations." badge="Setup" badgeTone="setup">
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <TeamAdminClient orgId={orgId} />;
}
