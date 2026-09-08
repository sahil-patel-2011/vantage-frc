import PowerBudgetClient from "./power-budget-client";

export const metadata = {
  title: "Power budget",
};

export default async function PowerBudgetPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <PowerBudgetClient orgId={orgId ?? null} />;
}
