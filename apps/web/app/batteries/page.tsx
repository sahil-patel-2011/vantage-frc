import BatteriesClient from "./batteries-client";

export default async function BatteriesPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <BatteriesClient orgId={orgId ?? null} />;
}
