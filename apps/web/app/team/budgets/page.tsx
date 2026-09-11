import { EmptyState, Button, PageHeader } from "../../../components/ui";
import {
  AI_BUDGETS_RELATED_INCLUDE,
  aiBudgetsRelatedLinks,
} from "../../../lib/billing/ai-budgets-related";
import BudgetClient from "./budget-client";

export const metadata = {
  title: "Chat limits",
};

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const links = aiBudgetsRelatedLinks(null, { include: [...AI_BUDGETS_RELATED_INCLUDE] });
    return (
      <main className="module-page ai-budgets-page">
        <PageHeader
          breadcrumbs="Chat / Limits"
          title="Chat limits"
          description="Each team sets its own Chat limits. Choose your team, then come back from Ask AI."
        />
        <nav className="product-hub-related ai-budgets-related" aria-label="Related AI budget tools">
          {links.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </nav>
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
