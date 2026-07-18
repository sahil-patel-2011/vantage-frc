import WeightBudgetClient from "./weight-budget-client";

export default async function WeightBudgetPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <WeightBudgetClient orgId={orgId ?? null} />;
}
