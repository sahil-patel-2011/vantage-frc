import { EmptyState } from "../../../components/ui";
import BudgetClient from "./budget-client";

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Select an organization"
          description="Open API budgets from Team admin so the workspace orgId is included."
        >
          <a className="app-button secondary" href="/team">
            Open Team admin
          </a>
        </EmptyState>
      </main>
    );
  }
  return <BudgetClient orgId={orgId} />;
}
