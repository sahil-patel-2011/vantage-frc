import { EmptyState, PageHeader } from "../../../components/ui";
import CapabilitiesClient from "./capabilities-client";
import HubAccessClient from "./hub-access-client";
import AuthPolicyClient from "./policy-client";

export const metadata = {
  title: "Team security",
};

export default async function TeamSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Security"
          title="Team security"
          description="Access policy, hub access, and capabilities are set per team — pick the team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="These controls change who can do what inside one workspace, so they need a team before they mean anything."
        >
          <a className="app-button" href="/workspace">
            Choose team
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
