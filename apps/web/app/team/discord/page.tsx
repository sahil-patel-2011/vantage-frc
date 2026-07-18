import { EmptyState, PageHeader } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import TeamDiscordClient from "./discord-client";

export default async function TeamDiscordPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Discord"
          title="Discord"
          description="Link a guild and channel for announcements and an optional object-linked chat bridge."
        />
        <TeamOpsNav active="admin" />
        <EmptyState
          title="Select a workspace"
          description="Open a team workspace to connect Discord."
          badge="Setup"
          badgeTone="setup"
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <TeamDiscordClient orgId={orgId} />;
}
