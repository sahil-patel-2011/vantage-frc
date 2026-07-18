import PowerBudgetClient from "./power-budget-client";

export default async function PowerBudgetPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <PowerBudgetClient orgId={orgId ?? null} />;
}
