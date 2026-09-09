import { EmptyState, PageHeader } from "../../../components/ui";
import AiHubClient from "./ai-hub-client";

export const metadata = {
  title: "AI Hub · Team",
};

export default async function TeamAiHubPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / AI Hub"
          title="AI Hub"
          description="Model routing, keys, and spend are per team — pick the workspace first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="The AI Hub reads one team’s real routing rules and ledger. Select the workspace and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <AiHubClient orgId={orgId} />;
}
