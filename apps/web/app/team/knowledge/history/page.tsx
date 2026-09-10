import { EmptyState, PageHeader, Button } from "../../../../components/ui";
import KnowledgeHistoryClient from "./history-client";

export const metadata = {
  title: "History · Knowledge",
};

export default async function TeamKnowledgeHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Knowledge / History"
          title="Knowledge history"
          description="Revisions belong to one team’s knowledge base — pick the team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose your team"
          description="History replays the edits a single team actually made. Select one and come back."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <KnowledgeHistoryClient orgId={orgId} />;
}
