import FundraisersClient from "./fundraisers-client";

export default async function FundraisersPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <FundraisersClient orgId={orgId ?? null} />;
}
