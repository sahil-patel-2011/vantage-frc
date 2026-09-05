import SubsystemsClient from "./subsystems-client";

export const metadata = {
  title: "Subsystem specs",
};

export default async function SubsystemsPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <SubsystemsClient orgId={orgId ?? null} />;
}
