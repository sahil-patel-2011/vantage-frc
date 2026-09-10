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
          description="Connect Slack to Vantage team chat so both sides stay on this team only."
        />
        <TeamOpsNav active="admin" />
        <EmptyState
          soft
          title="Select a team"
          description="Open a team to connect Slack. Team chat still works without Slack."
          badge="Setup required"
          badgeTone="setup"
        >
          <a className="app-button" href="/workspace">
            Choose your team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <TeamSlackClient orgId={orgId} />;
}
