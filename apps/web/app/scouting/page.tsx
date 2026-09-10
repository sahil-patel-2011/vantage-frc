import { EmptyState, Button } from "../../components/ui";
import { scoutingSetupSteps, scoutingShellCopy } from "../../lib/scouting/scouting-related";
import ScoutingClient from "./scouting-client";
import "./scouting.css";

export const metadata = {
  title: "Scouting",
};

export default async function ScoutingPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
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
  return <ScoutingClient orgId={orgId} />;
}
