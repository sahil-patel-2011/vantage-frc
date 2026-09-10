import { EmptyState, PageHeader, Button } from "../../../components/ui";
import GettingStartedClient from "./getting-started-client";
import "../../start/start.css";

export const metadata = {
  title: "Getting Started · Team",
};

export default async function TeamGettingStartedPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Getting started"
          title="Getting started"
          description="The setup checklist tracks one team’s real progress — pick the team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="Each step is ticked from that team’s own data, so it needs a team before it can say anything true."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <GettingStartedClient orgId={orgId} />;
}
