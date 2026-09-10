import { EmptyState, PageHeader } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import TeamBackgroundClient from "./background-client";

export const metadata = {
  title: "Background · Team",
};

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
          description="Mission, history, demographics, and achievements for sponsorship and grant drafts — scoped to your team only."
        />
        <TeamOpsNav active="admin" />
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Select a team"
          description="Open Team background from Team admin so the team is included."
        >
          <a className="app-button" href="/workspace">
            Choose your team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <TeamBackgroundClient orgId={orgId} />;
}
