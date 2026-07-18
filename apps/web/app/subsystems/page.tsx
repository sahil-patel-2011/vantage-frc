import SubsystemsClient from "./subsystems-client";

export default async function SubsystemsPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <SubsystemsClient orgId={orgId ?? null} />;
}
