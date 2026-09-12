import { EmptyState, PageHeader, Button } from "../../../components/ui";
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
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Audit"
          title="Audit"
          description="The membership, capability, and auth-policy trail belongs to one team — pick the team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose your team"
          description="Audit rows stay on this team. Choose your team to read the trail."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">Team / Audit</span>
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
