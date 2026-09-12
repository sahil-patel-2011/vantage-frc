import { EmptyState, PageHeader, Button } from "../../../../components/ui";
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
          description="Who exported what, for one team. Choose your team to open it."
        />
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Export records stay on this team. Choose your team to open the audit."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <ExportAuditClient orgId={orgId} />;
}
