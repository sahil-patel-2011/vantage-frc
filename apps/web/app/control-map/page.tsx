import ControlMapClient from "./control-map-client";

export const metadata = {
  title: "Control Map",
};

export default async function ControlMapPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <ControlMapClient orgId={orgId ?? null} />;
}
