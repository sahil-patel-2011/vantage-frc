import { redirect } from "next/navigation";
import OverviewClient from "./overview-client";

export const metadata = {
  title: "Platform admin",
};

export const dynamic = "force-dynamic";

/**
 * `/admin` is the Overview. Links made when it was the Teams page (the waitlist's "Find team" and
 * "Provision team", old bookmarks) carry ?find=, ?ownerEmail= or ?teamNumber= and still land on
 * Teams with them.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const keep = new URLSearchParams();
  for (const key of ["find", "ownerEmail", "teamNumber"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) keep.set(key, value.trim());
  }
  if ([...keep.keys()].length) redirect(`/admin/teams?${keep.toString()}`);
  return <OverviewClient />;
}
