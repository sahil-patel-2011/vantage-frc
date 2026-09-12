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
          description="Revisions belong to one team’s knowledge base. Choose your team to open it."
        />
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="History replays the edits this team actually made. Choose your team to open it."
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
