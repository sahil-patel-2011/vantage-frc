import { EmptyState } from "../../../components/ui";
import CapabilitiesClient from "./capabilities-client";
import HubAccessClient from "./hub-access-client";
import AuthPolicyClient from "./policy-client";

export default async function TeamSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Select an organization"
          description="Open Team security from Team admin so the workspace orgId is included."
        >
          <a className="app-button secondary" href="/team">
            Open Team admin
          </a>
        </EmptyState>
      </main>
    );
  }
  return (
    <>
      <AuthPolicyClient orgId={orgId} />
      <main className="module-page team-security-hub-access" style={{ paddingTop: 0 }}>
        <HubAccessClient orgId={orgId} />
      </main>
      <main className="module-page team-security-capabilities" style={{ paddingTop: 0 }}>
        <CapabilitiesClient orgId={orgId} />
      </main>
    </>
  );
}
