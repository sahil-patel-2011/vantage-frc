import { EmptyState } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
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
          badge="Setup"
          badgeTone="setup"
          title="Select a team"
          description="Each team sets its own Chat limits. Open Teams or Account, then come back from Ask AI."
        >
          <a className="app-button secondary" href="/workspace">
            Open Teams
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
