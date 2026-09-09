import CadSetupWizard from "./setup-client";
import "../cad-setup.css";

export const metadata = {
  title: "CAD Setup",
  description: "Connect CAD platforms and AI execution modes — allowlisted, approval-gated geometry.",
};

export default async function CadSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">CAD / Setup</span>
            <h1>Select a workspace</h1>
            <p className="app-muted">Connections belong to a team. Choose a workspace to run the setup wizard.</p>
          </div>
          <a className="primary-action" href="/workspace">
            Choose workspace →
          </a>
        </header>
      </main>
    );
  }
  return <CadSetupWizard orgId={orgId} />;
}
