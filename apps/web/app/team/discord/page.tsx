import { EmptyState, PageHeader, Button } from "../../../components/ui";
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
          description="Post team announcements to a Discord channel."
        >
          <nav className="product-hub-related" aria-label="Related team tools">
            <a href="/team?tab=messages">Messages</a>
            <a href="/team">Team</a>
          </nav>
        </PageHeader>
        <EmptyState
          soft
          title="Choose your team"
          description="Open a team to connect its Discord channel."
          badge="Needs setup"
          badgeTone="setup"
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <TeamDiscordClient orgId={orgId} />;
}
