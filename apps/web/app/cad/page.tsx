import CadWorkspace from "./cad-client";
import "./cad-setup.css";

export default async function CadPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page cad-module">
        <header className="app-page-header">
          <div>
            <p className="breadcrumbs">Build / CAD</p>
            <h1>Select an organization</h1>
            <p>Open CAD Builder from your team workspace so jobs stay scoped to the right org.</p>
          </div>
          <a className="app-button secondary" href="/workspace">
            Choose workspace
          </a>
        </header>
      </main>
    );
  }
  return <CadWorkspace orgId={orgId} />;
}

