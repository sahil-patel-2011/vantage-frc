import { withPagePaint } from "../../lib/page-org";
import { loadLeadSummary } from "../../lib/scouting/lead-summary-load";
import { loadScoutingBootstrap } from "../../lib/scouting/load-bootstrap";
import { ScoutingHome } from "./scouting-home";

export const metadata = {
  title: "Scouting",
};

export const dynamic = "force-dynamic";

export default async function ScoutingHomePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const paint = await withPagePaint("/scout", orgId, async ({ client, userId, orgId: resolved }) => {
    if (!resolved) return { orgId: null, bootstrap: null, summary: null };
    const [bootstrap, summary] = await Promise.all([
      loadScoutingBootstrap(client, { orgId: resolved, userId }),
      loadLeadSummary(client, { orgId: resolved, userId }),
    ]);
    return { orgId: resolved, bootstrap, summary };
  });
  return (
    <ScoutingHome
      orgId={paint?.orgId ?? null}
      initialBootstrap={paint?.bootstrap ?? null}
      initialSummary={paint?.summary ?? null}
    />
  );
}
