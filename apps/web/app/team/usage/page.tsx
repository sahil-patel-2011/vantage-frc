import { EmptyState, Button } from "../../../components/ui";
import UsageClient from "./usage-client";

export const metadata = {
  title: "Usage",
};

export default async function TeamUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page ai-budgets-page">
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Each team has its own AI usage log. Choose your team, then return from Ask AI."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <UsageClient orgId={orgId} />;
}
