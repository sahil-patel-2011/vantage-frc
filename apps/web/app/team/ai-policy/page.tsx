import { EmptyState, PageHeader } from "../../../components/ui";
import AiPolicyClient from "./ai-policy-client";

export const metadata = {
  title: "Governance",
};

export default async function TeamAiPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Governance"
          title="Governance"
          description="Which models and AI features a team may use — pick the workspace first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="Policy rules are written per workspace by its owners and admins. Select one and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <AiPolicyClient orgId={orgId} />;
}
