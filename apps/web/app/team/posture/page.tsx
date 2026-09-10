import { EmptyState, PageHeader } from "../../../components/ui";
import PostureClient from "./posture-client";

export const metadata = {
  title: "Posture · Team",
};

export default async function TeamPosturePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Posture"
          title="Security posture"
          description="Posture is scored from one team’s real settings and members — pick the team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="Every check reads that team’s own configuration, so it needs a team before it can score anything."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <PostureClient orgId={orgId} />;
}
