import GrantsClient from "./grants-client";

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content soft-gate">
        <span className="eyebrow">VANTAGE / GRANTS</span>
        <h1>Select a workspace</h1>
        <p>
          Grant opportunities, applications, and essay items are org-scoped. Choose a team workspace to open the
          writing workbench.
        </p>
        <a href="/workspace">Select workspace</a>
      </main>
    );
  }
  return <GrantsClient orgId={orgId} />;
}
