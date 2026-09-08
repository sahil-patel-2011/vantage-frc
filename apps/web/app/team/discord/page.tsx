import { EmptyState, PageHeader } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import TeamDiscordClient from "./discord-client";

export const metadata = {
  title: "Discord",
};

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
          soft
          title="Select a workspace"
          description="Open a team workspace to connect Discord and the object-linked Messages bridge."
          badge="Setup required"
          badgeTone="setup"
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
          <nav className="product-hub-related" aria-label="Related team tools" style={{ marginTop: 12 }}>
            <a className="app-button secondary" href="/team?tab=messages">
              Messages
            </a>
            <a className="app-button secondary" href="/team">
              Team
            </a>
          </nav>
        </EmptyState>
      </main>
    );
  }
  return <TeamDiscordClient orgId={orgId} />;
}
