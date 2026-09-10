import { EmptyState, PageHeader } from "../../../../components/ui";
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
          title="Choose a team"
          description="History replays the edits a single workspace actually made. Select one and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <KnowledgeHistoryClient orgId={orgId} />;
}
