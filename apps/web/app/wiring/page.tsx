import WiringClient from "./wiring-client";

export default async function WiringPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <WiringClient orgId={orgId ?? null} />;
}
