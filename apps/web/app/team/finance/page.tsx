import { redirect } from "next/navigation";

export const metadata = {
  title: "Finance · Team",
};

/** Legacy finance UI — unified under Business Portal. */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  const query = new URLSearchParams({ tab: "budget" });
  if (orgId) query.set("orgId", orgId);
  redirect(`/business?${query.toString()}`);
}
