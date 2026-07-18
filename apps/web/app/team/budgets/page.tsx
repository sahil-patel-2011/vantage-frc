import { EmptyState } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
import BudgetClient from "./budget-client";

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page ai-budgets-page">
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Select a team workspace"
          description="API budgets are org-scoped. Open Workspace or Account, then return from the AI hub — never invent DEMO spend caps."
        >
          <a className="app-button secondary" href="/workspace">
            Open Workspace
          </a>
          <a className="app-button secondary" href={withOrgHref("/account", null)}>
            Account
          </a>
          <a className="app-button secondary" href={withOrgHref("/pricing", null)}>
            Pricing
          </a>
        </EmptyState>
      </main>
    );
  }
  return <BudgetClient orgId={orgId} />;
}
