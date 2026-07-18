import ShooterTableClient from "./shooter-table-client";

export default async function ShooterTablePage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <ShooterTableClient orgId={orgId ?? null} />;
}
