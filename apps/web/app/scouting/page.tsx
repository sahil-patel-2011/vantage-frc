import { EmptyState } from "../../components/ui";
import ScoutingClient from "./scouting-client";
import "./scouting.css";

export default async function ScoutingPage({
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
          description="Open scouting from your team workspace so the active event can be cached for offline match and pit entry."
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <ScoutingClient orgId={orgId} />;
}
