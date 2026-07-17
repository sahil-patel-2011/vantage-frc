import CadWorkspace from "./cad-client";

export default async function CadPage({
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
            <p className="breadcrumbs">Workspace / CAD Builder</p>
            <h1>Select an organization</h1>
            <p>Open CAD Builder from your team workspace so jobs stay scoped to the right org.</p>
          </div>
          <a className="app-button secondary" href="/dashboard">
            Back to dashboard
          </a>
        </header>
      </main>
    );
  }
  return <CadWorkspace orgId={orgId} />;
}

