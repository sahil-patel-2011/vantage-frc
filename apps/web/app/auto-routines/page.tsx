import AutoRoutinesClient from "./auto-routines-client";

export default async function AutoRoutinesPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <AutoRoutinesClient orgId={orgId ?? null} />;
}
