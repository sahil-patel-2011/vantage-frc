import { EmptyState, PageHeader, Button } from "../../../components/ui";
import AiRunsClient from "./ai-runs-client";

export const metadata = {
  title: "Ask AI history · Team",
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
          breadcrumbs="Team / Ask AI history"
          title="Ask AI history"
          description="Ask AI history is recorded for one team — choose your team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose your team"
          description="Ask AI history belongs to one team. Choose your team to open it."
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
