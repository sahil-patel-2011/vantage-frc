import { EmptyState, Button } from "../../../components/ui";
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
          title="Choose your team"
          description="Each team sets its own Chat limits. Open Teams or Account, then come back from Ask AI."
        >
          <Button as="a" variant="secondary" href="/workspace">
            Open Teams
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/account", null)}>
            Account
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/pricing", null)}>
            Pricing
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <BudgetClient orgId={orgId} />;
}
