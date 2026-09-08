import AuditLogClient from "./audit-client";

export const metadata = {
  title: "Audit · Team",
};

export default async function TeamAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / SECURITY AUDIT</span>
          <h1>Who changed what</h1>
          <p className="app-muted">
            A reverse-chronological trail of every membership, capability, invitation, and
            authentication-policy change for this team.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Security links">
          <a href={`/team/security?orgId=${orgId}`}>Access policy</a>
          <a href={`/team/posture?orgId=${orgId}`}>Posture</a>
          <a href={`/team/security/exports?orgId=${orgId}`}>Export audit</a>
          <a href={`/team/usage?orgId=${orgId}`}>AI usage</a>
        </nav>
      </header>
      <AuditLogClient orgId={orgId} />
    </main>
  );
}
