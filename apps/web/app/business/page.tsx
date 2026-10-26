import type { Metadata } from "next";
import { currentBusinessSeason, loadBusinessView } from "../../lib/business-data";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import { withPagePaint } from "../../lib/page-org";
import BusinessClient from "./business-client";
import "./business.css";

type Props = { searchParams: Promise<{ tab?: string; orgId?: string }> };

const description = "Money, sponsors, grants, and outreach.";

/** "Money · Business", "Sponsors · Business": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("business", tab), description };
}

export const dynamic = "force-dynamic";

export default async function BusinessPage({ searchParams }: Props) {
  const { tab, orgId } = await searchParams;
  const overview = !tab || tab === "overview";
  const view = overview
    ? await withPagePaint("/business", orgId, ({ client, userId, orgId: resolved }) =>
        loadBusinessView(client, { userId, requestedOrg: resolved, seasonYear: currentBusinessSeason() }),
      )
    : null;
  return <BusinessClient initialTab={tab ?? null} initialView={view} />;
}
