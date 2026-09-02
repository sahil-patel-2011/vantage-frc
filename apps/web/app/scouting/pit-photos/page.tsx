import { EmptyState, PageHeader } from "../../../components/ui";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import PitPhotosClient from "./pit-photos-client";
import "./pit-photos.css";

export default async function PitPhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; eventKey?: string; teamKey?: string }>;
}) {
  const { orgId, eventKey, teamKey } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page pit-photos-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Scouting / Pit photos"
          title="Pit photos"
          description="Every robot photo your scouts capture, grouped by team for the active event. Works offline once the wall has loaded on this device."
        >
          <nav className="product-hub-related pit-photos-related" aria-label="Related competition tools">
            <a className="app-button secondary" href={hubHref("/competition", "scouting", null)}>
              Scouting
            </a>
            <a className="app-button secondary" href={withOrgHref("/scouting/lineup", null)}>
              Coverage
            </a>
          </nav>
        </PageHeader>
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Select a workspace"
          description="Pit photos are org-isolated. Pick your team workspace to open its photo wall."
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <PitPhotosClient orgId={orgId} eventKey={eventKey ?? null} teamKey={teamKey ?? null} />;
}
