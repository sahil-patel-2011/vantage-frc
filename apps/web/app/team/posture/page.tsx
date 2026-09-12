import { EmptyState, PageHeader, Button } from "../../../components/ui";
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
          description="Posture is scored from one team’s real settings and members. Choose your team to open it."
        />
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Every check reads that team’s own configuration, so it needs a team before it can score anything."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <PostureClient orgId={orgId} />;
}
