import { Button, EmptyState, PageHeader } from "../../../../components/ui";
import { PlatformTeamMembers } from "./team-members-client";
import "../../admin-console.css";

export const metadata = {
  title: "Members and permissions · Platform admin",
};

export const dynamic = "force-dynamic";

/** Platform admin → Teams → a team → Members and permissions (the platform owner's). */
export default async function AdminTeamMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page admin-control ac-page">
        <PageHeader title="Members and permissions" />
        <EmptyState soft title="Pick a team" description="Open a team from the list, then choose Members and permissions.">
          <Button as="a" variant="secondary" href="/admin/teams">
            All teams
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <PlatformTeamMembers orgId={orgId} />;
}
