import { EmptyState, Button, PageHeader } from "../../../components/ui";
import {
  AI_USAGE_RELATED_INCLUDE,
  aiBudgetsRelatedLinks,
} from "../../../lib/billing/ai-budgets-related";
import { hubHref } from "../../../lib/nav/hubs";
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
    const links = aiBudgetsRelatedLinks(null, { include: [...AI_USAGE_RELATED_INCLUDE] });
    return (
      <main className="module-page ai-budgets-page">
        <PageHeader
          breadcrumbs="Ask AI / Usage"
          title="Usage"
          description="Each team has its own AI usage log. Choose your team, then return from Ask AI."
        />
        <nav className="product-hub-related ai-budgets-related" aria-label="Related AI usage tools">
          <Button as="a" variant="secondary" href={hubHref("/ai", "budgets")}>
            Chat limits
          </Button>
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
