import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EmptyState, Button } from "../../components/ui";
import { resolvePageOrg } from "../../lib/page-org";
import { loadScoutingBootstrap } from "../../lib/scouting/load-bootstrap";
import { scoutingSetupSteps, scoutingShellCopy } from "../../lib/scouting/scouting-related";
import { withScoutingRequest } from "../../lib/scouting-auth";
import ScoutingClient from "./scouting-client";
import type { Bootstrap } from "./scouting-model";
import "./scouting.css";

export const metadata = {
  title: "Scouting",
};

export const dynamic = "force-dynamic";

export default async function ScoutingPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; eventKey?: string }>;
}) {
  const { orgId: requested, eventKey } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fscouting");
  const orgId = await resolvePageOrg(session.user.id, requested);
  if (!orgId) {
    const copy = scoutingShellCopy("setup");
    const setup = scoutingSetupSteps(null)[0];
    return (
      <main className="module-page scout-page soft-gate">
        <EmptyState
          soft
          className="scout-shell-empty"
          badge={copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }
  let initialData: Bootstrap | null;
  try {
    initialData = (await withScoutingRequest(orgId, (client) =>
      loadScoutingBootstrap(client, { orgId, userId: session.user.id, eventKey }),
    )) as Bootstrap;
  } catch {
    initialData = null;
  }
  return <ScoutingClient key={orgId} orgId={orgId} initialData={initialData} />;
}
