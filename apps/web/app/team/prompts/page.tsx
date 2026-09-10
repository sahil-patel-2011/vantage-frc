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
          title="Choose your team"
          description="Prompts stay inside one team. Choose your team to open the library."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <PromptsClient orgId={orgId} />;
}
