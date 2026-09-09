import { EmptyState, PageHeader } from "../../components/ui";
import ShowcaseClient from "./showcase-client";

export const metadata = {
  title: "Showcase",
};

export default async function ShowcasePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    // Was a bare `<h1>Select an organization</h1>` with nothing to click — the
    // page told you to pick a team and then gave you no way to do it. Every
    // other org-gated surface uses this shell plus the Workspace picker.
    return (
      <main className="module-page">
        <PageHeader
          // navPath resolved to a bare "Vantage": /showcase is reachable from My
          // Kit but has no product-nav entry, so breadcrumbForPath finds nothing
          // to name. Spelled out, like every other org-gated screen.
          breadcrumbs="Media / Showcase"
          title="Showcase"
          description="A shareable season showcase for one team — pick the workspace first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="Showcase renders one team's real season. Select the workspace and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <ShowcaseClient orgId={orgId} />;
}
