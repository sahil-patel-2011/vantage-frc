import { EmptyState, Button } from "../../../components/ui";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
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
          badge="Setup"
          badgeTone="setup"
          title="Select a team"
          description="Each team has its own AI usage log. Choose your team or Account, then return from the AI hub."
        >
          <Button as="a" variant="secondary" href="/workspace">
            Choose your team
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/account", null)}>
            Account
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/pricing", null)}>
            Pricing
          </Button>
          <Button as="a" variant="secondary" href={hubHref("/ai", "chat", null)}>
            Chat
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <UsageClient orgId={orgId} />;
}
