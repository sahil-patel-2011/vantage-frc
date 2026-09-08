import GearboxClient from "./gearbox-client";

export const metadata = {
  title: "Gearbox calculator",
};

export default async function GearboxPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <GearboxClient orgId={orgId ?? null} />;
}
