import type { Metadata } from "next";
import { loadKickoffView } from "../api/kickoff/route";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import { withPagePaint } from "../../lib/page-org";
import BuildHub from "./build-hub";

type Props = { searchParams: Promise<{ tab?: string; orgId?: string }> };

const description = "Kickoff, CAD, code, and the robot.";

/** "Code · Build", "CAD · Build": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("build", tab), description };
}

export const dynamic = "force-dynamic";

export default async function BuildPage({ searchParams }: Props) {
  const { tab, orgId } = await searchParams;
  const paint = await withPagePaint("/build", orgId, async ({ client, userId, orgId: resolved }) => {
    const kickoffTab = !tab || tab === "kickoff";
    if (!resolved || !kickoffTab) return { orgId: resolved, kickoff: null };
    return { orgId: resolved, kickoff: await loadKickoffView(client, userId, resolved) };
  });
  return (
    <BuildHub
      initialTab={tab ?? null}
      initialOrgId={paint?.orgId ?? null}
      initialKickoff={paint?.kickoff ?? null}
    />
  );
}
