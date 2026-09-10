import { EmptyState, PageHeader } from "../../../components/ui";
import PromptsClient from "./prompts-client";

export const metadata = {
  title: "Prompts · Team",
};

export default async function TeamPromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Prompts"
          title="Prompts"
          description="The shared prompt library is per team — pick the team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="Prompts are written and reused inside one workspace and never leak between teams. Select one and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <PromptsClient orgId={orgId} />;
}
