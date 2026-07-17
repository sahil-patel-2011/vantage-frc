import TeamAdminClient from "./team-admin-client";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content soft-gate">
        <span className="eyebrow">VANTAGE / TEAM ADMIN</span>
        <h1>Select a workspace</h1>
        <p>Membership, invites, and provider settings are org-scoped. Choose a team workspace to continue.</p>
        <a href="/workspace">Select workspace</a>
      </main>
    );
  }
  return <TeamAdminClient orgId={orgId} />;
}
