import type { Metadata } from "next";
import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadEventDayCommand } from "../../lib/command/load-command";
import { loadMyDayView } from "../../lib/my-day-load";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import { resolvePageOrg, withPagePaint } from "../../lib/page-org";
import { loadDataSourceHealth } from "../../lib/reference-health";
import { loadScoutingBootstrap } from "../../lib/scouting/load-bootstrap";
import { withScoutingRequest } from "../../lib/scouting-auth";
import { computeStrategyView } from "../../lib/strategy/compute-strategy";
import { finalizeStrategyRecompute } from "../../lib/strategy/recompute";
import CommandClient from "../command/command-client";
import MyDayClient from "../my-day/my-day-client";
import type { Bootstrap } from "../scouting/scouting-model";
import StrategyClient from "../strategy/strategy-client";
import CompetitionHub from "./competition-hub";

type Props = { searchParams: Promise<{ tab?: string; orgId?: string; eventKey?: string; matchKey?: string }> };

const description = "Event day, scouting, strategy, and pit.";

/** "Scout · Competition", "My Day · Competition": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("competition", tab), description };
}

export const dynamic = "force-dynamic";

export default async function CompetitionPage({ searchParams }: Props) {
  const { tab, orgId: orgIdParam, eventKey, matchKey } = await searchParams;
  const search = new URLSearchParams();
  if (tab) search.set("tab", tab);
  if (eventKey) search.set("eventKey", eventKey);

  // These three are main routes (/command, /my-day, /strategy) that land here.
  // Their data has to be in this response; the hub otherwise paints a skeleton
  // and fetches after load.
  if (tab === "command" || tab === "my-day" || tab === "strategy") {
    const nextPath = `/competition?tab=${tab}`;
    const paint = await withPagePaint(nextPath, orgIdParam, async ({ client, userId, orgId }) => {
      if (!orgId) return { orgId, command: null, myDay: null, strategy: null };
      if (tab === "command") {
        const [command, dataSourceHealth] = await Promise.all([
          loadEventDayCommand(client, { orgId, userId }),
          loadDataSourceHealth(client, orgId),
        ]);
        return { orgId, command: { ...command, dataSourceHealth }, myDay: null, strategy: null };
      }
      if (tab === "my-day") {
        const myDay = await loadMyDayView(client, { userId, requestedOrg: orgId });
        return { orgId, command: null, myDay, strategy: null };
      }
      const [strategy, dataSourceHealth] = await Promise.all([
        computeStrategyView(client, {
          userId,
          requestedOrg: orgId,
          matchKey: matchKey ?? null,
          readOnly: true,
        }),
        loadDataSourceHealth(client, orgId),
      ]);
      return {
        orgId,
        command: null,
        myDay: null,
        strategy: { ...finalizeStrategyRecompute(strategy), dataSourceHealth },
      };
    });
    const orgId = paint?.orgId ?? null;
    if (orgId) search.set("orgId", orgId);
    const commandPanel =
      tab === "command" && orgId && paint?.command ? (
        <CommandClient embedded initialOrgId={orgId} initialSnap={paint.command} />
      ) : null;
    const myDayPanel = tab === "my-day" && paint?.myDay ? <MyDayClient embedded initial={paint.myDay} /> : null;
    const strategyPanel =
      tab === "strategy" && paint?.strategy ? <StrategyClient embedded initialView={paint.strategy} /> : null;
    return (
      <CompetitionHub
        initialTab={tab ?? null}
        initialOrgId={orgId}
        initialSearch={search.toString()}
        commandPanel={commandPanel}
        myDayPanel={myDayPanel}
        strategyPanel={strategyPanel}
      />
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fcompetition");
  const orgId = await resolvePageOrg(session.user.id, orgIdParam);
  if (orgId) search.set("orgId", orgId);
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
