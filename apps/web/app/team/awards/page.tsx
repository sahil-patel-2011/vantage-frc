import { Button, EmptyState, PageHeader } from "../../../components/ui";
import AwardsClient from "./awards-client";
import "./awards.css";

export const metadata = {
  title: "FIRST award submissions",
};

export default async function AwardsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page awards-page">
        <PageHeader
          breadcrumbs="Business / Awards"
          title="Awards"
          description="Award submissions and essay prompts belong to one team — choose your team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose your team"
          description="Award essays stay with one team. Choose your team to open them. Sponsors and Grants stay on Business."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <AwardsClient orgId={orgId} />;
}
