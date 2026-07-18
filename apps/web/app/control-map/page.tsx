import ControlMapClient from "./control-map-client";

export default async function ControlMapPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <ControlMapClient orgId={orgId ?? null} />;
}
