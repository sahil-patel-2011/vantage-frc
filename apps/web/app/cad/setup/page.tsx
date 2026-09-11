import CadSetupWizard, { CadSetupRelated } from "./setup-client";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
import "../cad-setup.css";

export const metadata = {
  title: "CAD setup",
  description: "Connect Onshape in the browser, or pair Fusion on this computer.",
};

export default async function CadSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page cad-setup-page">
        <PageHeader
          breadcrumbs="CAD / Setup"
          title="CAD setup"
          description="CAD connections belong to a team."
        >
          <CadSetupRelated orgId={null} />
        </PageHeader>
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Choose your team"
          description="Choose your team to connect Onshape or pair Fusion."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <CadSetupWizard orgId={orgId} />;
}
