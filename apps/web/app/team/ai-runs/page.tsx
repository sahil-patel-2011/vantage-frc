import { EmptyState, PageHeader, Button } from "../../../components/ui";
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
          description="Every metered AI call is recorded against one team — pick the team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose your team"
          description="Runs come from this team's usage ledger. Choose your team to open them."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <AiRunsClient orgId={orgId} />;
}
