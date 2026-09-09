import { EmptyState, PageHeader } from "../../../components/ui";
import AiMemoryClient from "./ai-memory-client";

export const metadata = {
  title: "Memory",
};

export default async function TeamAiMemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Memory"
          title="Memory"
          description="What the assistant remembers is scoped to one team — pick the workspace first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="Memory entries belong to a single workspace and never cross teams. Select one and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <AiMemoryClient orgId={orgId} />;
}
