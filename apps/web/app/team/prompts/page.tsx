import { EmptyState, PageHeader, Button } from "../../../components/ui";
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
          description="Prompts are written and reused inside one team and never leak between teams. Select one and come back."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <PromptsClient orgId={orgId} />;
}
