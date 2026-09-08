import { EmptyState, PageHeader } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import TeamSlackClient from "./slack-client";

export const metadata = {
  title: "Slack",
};

export default async function TeamSlackPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Slack"
          title="Slack"
          description="Connect Slack to Vantage team chat so both sides stay in this workspace only."
        />
        <TeamOpsNav active="admin" />
        <EmptyState
          soft
          title="Select a workspace"
          description="Open a team workspace to connect Slack. Team chat still works without Slack."
          badge="Setup required"
          badgeTone="setup"
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <TeamSlackClient orgId={orgId} />;
}
