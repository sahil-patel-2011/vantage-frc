import { EmptyState, PageHeader } from "../../../components/ui";
import AiRunsClient from "./ai-runs-client";

export const metadata = {
  title: "AI Runs · Team",
};

export default async function TeamAiRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / AI Runs"
          title="AI Runs"
          description="Every metered AI call is recorded against one team — pick the workspace first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="Runs come from that workspace’s real usage ledger — nothing is pre-seeded. Select one and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <AiRunsClient orgId={orgId} />;
}
