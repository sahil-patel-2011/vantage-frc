import { EmptyState, PageHeader } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import TeamBackgroundClient from "./background-client";

export default async function TeamBackgroundPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Background"
          title="Team background"
          description="Mission, history, demographics, and achievements for sponsorship and grant drafts — scoped to your workspace only."
        />
        <TeamOpsNav active="admin" />
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Select a workspace"
          description="Open Team background from Team admin so the workspace orgId is included."
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <TeamBackgroundClient orgId={orgId} />;
}
