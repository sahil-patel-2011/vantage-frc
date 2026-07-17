import FinanceClient from "./finance-client";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <FinanceClient orgId={orgId} />;
}
