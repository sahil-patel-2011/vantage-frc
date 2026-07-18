import { EmptyState } from "../../components/ui";
import IntelClient from "./intel-client";

export default async function IntelPage({
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
          description="Open Intel from a team workspace to prioritize teams at your active event — no fabricated EPA or ranks."
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <IntelClient orgId={orgId} />;
}
