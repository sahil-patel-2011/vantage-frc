import SafetyClient from "./safety-client";

export default async function SafetyPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <SafetyClient orgId={orgId ?? null} />;
}
