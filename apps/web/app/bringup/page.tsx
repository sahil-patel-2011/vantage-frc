import BringupClient from "./bringup-client";

export default async function BringupPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <BringupClient orgId={orgId ?? null} />;
}
