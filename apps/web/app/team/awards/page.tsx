import AwardsClient from "./awards-client";

export default async function AwardsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content soft-gate">
        <span className="eyebrow">VANTAGE / AWARDS</span>
        <h1>Select a workspace</h1>
        <p>
          FIRST award submissions and essay prompts are org-scoped. Choose a team workspace to open the awards
          workbench.
        </p>
        <a href="/workspace">Select workspace</a>
      </main>
    );
  }
  return <AwardsClient orgId={orgId} />;
}
