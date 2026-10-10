import { redirect } from "next/navigation";
import { scoutingQualityHref, type QualityQuery } from "../../lib/scouting/quality-navigation";
export const metadata = { title: "Scouting quality" };
export default async function ScoutCrossvalPage({ searchParams }: { searchParams: Promise<QualityQuery> }) {
  redirect(scoutingQualityHref(await searchParams, "checks"));
}
