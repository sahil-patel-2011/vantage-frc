import CadConnections, { CadConnectionsRelated } from "./connections-client";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
import "../cad-setup.css";

export const metadata = {
  title: "CAD connections",
  description: "Connect Onshape in the browser, or pair the Fusion desktop app.",
};

export default async function CadConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page cad-connections-page">
        <PageHeader
          breadcrumbs="CAD / Connections"
          title="CAD connections"
          description="Connections belong to a team."
        >
          <CadConnectionsRelated orgId={null} />
        </PageHeader>
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Choose your team to link Onshape and paired desktops."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <CadConnections orgId={orgId} />;
}
