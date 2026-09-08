import { redirect } from "next/navigation";

export const metadata = {
  title: "Sponsors · Team",
};

/** Legacy sponsors CRM — unified under Business Portal. */
export default async function SponsorsPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  const query = new URLSearchParams({ tab: "sponsors" });
  if (orgId) query.set("orgId", orgId);
  redirect(`/business?${query.toString()}`);
}
