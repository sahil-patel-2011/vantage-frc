import ExportAuditClient from "./export-audit-client";

export default async function TeamExportAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <ExportAuditClient orgId={orgId} />;
}
