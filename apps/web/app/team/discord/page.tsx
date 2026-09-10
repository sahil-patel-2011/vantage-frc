import { EmptyState, PageHeader, Button } from "../../../components/ui";
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
          title="Select a team"
          description="Open a team to connect Discord and the object-linked Messages bridge."
          badge="Setup required"
          badgeTone="setup"
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
          <nav className="product-hub-related" aria-label="Related team tools" style={{ marginTop: 12 }}>
            <Button as="a" variant="secondary" href="/team?tab=messages">
              Messages
            </Button>
            <Button as="a" variant="secondary" href="/team">
              Team
            </Button>
          </nav>
        </EmptyState>
      </main>
    );
  }
  return <TeamDiscordClient orgId={orgId} />;
}
