import { EmptyState, PageHeader } from "../../../../components/ui";
import ExportAuditClient from "./export-audit-client";

export const metadata = {
  title: "Exports · Security",
};

export default async function TeamExportAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Security / Exports"
          title="Export audit"
          description="Who exported what, for one team — pick the team first."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose a team"
          description="Export records are written per team so one team can never read another’s. Select one and come back."
        >
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <ExportAuditClient orgId={orgId} />;
}
