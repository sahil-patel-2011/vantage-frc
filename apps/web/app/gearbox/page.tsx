import GearboxClient from "./gearbox-client";

export default async function GearboxPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <GearboxClient orgId={orgId ?? null} />;
}
