import { EmptyState, Button, PageHeader } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
import ScoutingTrustPanel from "../scouting-trust-panel";
import "../scouting.css";
export const metadata = { title: "Scouting quality" };
export default async function ScoutingQualityPage({ searchParams }: {
  searchParams: Promise<{ orgId?: string; eventKey?: string; section?: string }>;
}) {
  const { orgId, eventKey, section } = await searchParams;
  return <main className="module-page scout-page scout-quality-page">
    <PageHeader breadcrumbs="Competition / Scouting" title="Scouting quality" description="Official checks, scout consistency and alliance review in one workspace.">
      {orgId ? <Button as="a" variant="secondary" href={withOrgHref(`/scout-coverage-live${eventKey ? `?eventKey=${encodeURIComponent(eventKey)}` : ""}`, orgId)}>Assignments</Button> : null}
    </PageHeader>
    {orgId ? <ScoutingTrustPanel key={`${orgId}:${eventKey ?? "active"}`} orgId={orgId} eventKey={eventKey ?? null} initialSection={section === "scouts" || section === "impact" || section === "alliance" || section === "rules" ? section : "checks"} /> :
      <EmptyState title="Choose your team" description="Quality checks use the reports and official results for one team and event."><Button as="a" variant="primary" href="/workspace">Choose team</Button></EmptyState>}
  </main>;
}
