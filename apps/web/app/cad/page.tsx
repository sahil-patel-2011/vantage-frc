import { cadToolSupportMatrix } from "@vantage/cad";
import { EmptyState, PageHeader } from "../../components/ui";
import CadWorkspace from "./cad-client";
import "./cad-setup.css";

export const metadata = {
  title: "CAD",
};

export default async function CadPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page cad-module">
        <PageHeader
          breadcrumbs="Build / CAD"
          title="CAD"
          description="The Onshape agent works inside one team’s documents — pick the workspace first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="CAD stays scoped to the org whose Onshape connection and part history it is allowed to touch. Select the workspace and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  // Rendered from the shipped catalog, not fetched, so the "Onshape only" labels
  // can never disagree with the tools this deployment actually runs.
  return <CadWorkspace orgId={orgId} tools={cadToolSupportMatrix()} />;
}

