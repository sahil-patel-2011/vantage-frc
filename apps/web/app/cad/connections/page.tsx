import CadConnections from "./connections-client";
import "../cad-setup.css";

export const metadata = {
  title: "CAD Connections",
  description: "Connect Onshape OAuth or pair a Fusion desktop relay — password never enters the terminal.",
};

export default async function CadConnectionsPage({
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
            <span className="breadcrumbs">CAD / Connections</span>
            <h1>Select a team</h1>
            <p className="app-muted">Connections belong to a team. Choose a team to link CAD accounts and devices.</p>
          </div>
          <a className="primary-action" href="/workspace">
            Choose your team →
          </a>
        </header>
      </main>
    );
  }
  return <CadConnections orgId={orgId} />;
}
