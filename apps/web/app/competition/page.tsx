import type { Metadata } from "next";
import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import { resolvePageOrg } from "../../lib/page-org";
import { loadScoutingBootstrap } from "../../lib/scouting/load-bootstrap";
import { withScoutingRequest } from "../../lib/scouting-auth";
import CompetitionHub from "./competition-hub";
import type { Bootstrap } from "../scouting/scouting-model";

type Props = { searchParams: Promise<{ tab?: string; orgId?: string; eventKey?: string }> };

const description = "Event day, scouting, strategy, and pit.";

/** "Scout · Competition", "My Day · Competition": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("competition", tab), description };
}

export const dynamic = "force-dynamic";

export default async function CompetitionPage({ searchParams }: Props) {
  const { tab, orgId: orgIdParam, eventKey } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fcompetition");
  const orgId = await resolvePageOrg(session.user.id, orgIdParam);
  const search = new URLSearchParams();
  if (tab) search.set("tab", tab);
  if (orgId) search.set("orgId", orgId);
  if (eventKey) search.set("eventKey", eventKey);
  const defaultTab = !tab || tab === "scouting";
  let initialScouting: Bootstrap | null = null;
  if (orgId && defaultTab) {
    try {
      initialScouting = (await withScoutingRequest(orgId, (client) =>
        loadScoutingBootstrap(client, { orgId, userId: session.user.id, eventKey }),
      )) as Bootstrap;
    } catch {
      initialScouting = null;
    }
  }
  return (
    <CompetitionHub
      initialTab={tab ?? null}
      initialOrgId={orgId}
      initialSearch={search.toString()}
      initialScouting={initialScouting}
    />
  );
}
