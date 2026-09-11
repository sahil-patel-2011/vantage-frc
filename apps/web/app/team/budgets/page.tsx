import { EmptyState, Button } from "../../../components/ui";
import BudgetClient from "./budget-client";

export const metadata = {
  title: "Chat limits",
};

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page ai-budgets-page">
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Each team sets its own Chat limits. Choose your team, then come back from Ask AI."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <BudgetClient orgId={orgId} />;
}
