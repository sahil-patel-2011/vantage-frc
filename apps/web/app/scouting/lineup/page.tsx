import { redirect } from "next/navigation";

export const metadata = { title: "Scouting assignments" };

/** The legacy edit route preserves every query value in the canonical workspace. */
export default async function ScoutingLineupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  redirect(`/scout-coverage-live${params.size ? `?${params}` : ""}`);
}
