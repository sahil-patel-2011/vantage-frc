import { EmptyState } from "../../../components/ui";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import UsageClient from "./usage-client";

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
          title="Select a team workspace"
          description="AI usage ledgers are org-scoped. Open Workspace or Account, then return from the AI hub — never invent DEMO activity."
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
          <a className="app-button secondary" href={hubHref("/ai", "chat", null)}>
            Chat
          </a>
        </EmptyState>
      </main>
    );
  }
  return <UsageClient orgId={orgId} />;
}
