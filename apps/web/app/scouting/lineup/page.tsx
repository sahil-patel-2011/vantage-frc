import { EmptyState } from "../../../components/ui";
import LineupClient from "./lineup-client";

export default async function ScoutingLineupPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <EmptyState
          badge="Workspace"
          badgeTone="setup"
          title="Select a workspace"
          description="Open lineup & coverage from your team workspace so match rows can load for the active event."
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <LineupClient orgId={orgId} />;
}
