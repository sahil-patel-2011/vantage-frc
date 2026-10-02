import { PageHeader } from "../../../components/ui";
import { Icon } from "../../../components/icon";
import { withOrgHref } from "../../../lib/nav/product-nav";
import "./connect.css";

export const metadata = { title: "Connect AI", description: "Choose how to connect an assistant to Vantage." };

export default async function ConnectAiPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return (
    <main className="module-page ai-connect-page">
      <PageHeader title="Connect AI" description="Choose the connection that works for you. You can change it later." />
      <section className="ai-connect-methods" aria-label="AI connection options">
        <a className="app-card soft-panel ai-connect-method" href={withOrgHref("/team/ai-bridge", orgId)}>
          <Icon name="display" /><div><h2>Use your Codex account</h2><p>Connect your computer to run Vantage requests with your own account. Your computer needs to stay connected.</p><span>Set up your computer <span aria-hidden="true">→</span></span></div>
        </a>
        <a className="app-card soft-panel ai-connect-method" href={withOrgHref("/team/ai-keys", orgId)}>
          <Icon name="cloud" /><div><h2>Connect an AI provider</h2><p>Add your own provider key, or manage a shared team connection. Supports Google, OpenAI, Anthropic, and more.</p><span>Choose a provider <span aria-hidden="true">→</span></span></div>
        </a>
      </section>
      <p className="ai-connect-help">Personal connections are yours. Shared team settings require an owner or admin.</p>
      <a className="ai-connect-back" href={withOrgHref("/ai", orgId)}>Back to AI</a>
    </main>
  );
}
