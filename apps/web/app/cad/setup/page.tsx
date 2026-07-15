import CadSetupWizard from "./setup-client";

export default async function CadSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content">
        <h1>Select an organization</h1>
        <p>
          <a href="/dashboard">Go to your dashboard to choose a team</a>
        </p>
      </main>
    );
  }
  return <CadSetupWizard orgId={orgId} />;
}
