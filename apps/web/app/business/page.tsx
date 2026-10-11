import type { Metadata } from "next";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import BusinessClient from "./business-client";
import "./business.css";

type Props = { searchParams: Promise<{ tab?: string }> };

const description = "Money, sponsors, grants, and outreach.";

/** "Money · Business", "Sponsors · Business": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("business", tab), description };
}

export default async function BusinessPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <BusinessClient initialTab={tab ?? null} />;
}
