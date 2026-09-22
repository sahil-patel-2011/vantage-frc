import { redirect } from "next/navigation";

export const metadata = {
  title: "Stats",
};

/**
 * The match-week Stats button used to open this address, which had no page.
 * Rankings is the live board (standings, records, ratings). Old links land there.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const query = new URLSearchParams();
  if (orgId) query.set("orgId", orgId);
  const suffix = query.toString();
  redirect(suffix ? `/rankings?${suffix}` : "/rankings");
}
