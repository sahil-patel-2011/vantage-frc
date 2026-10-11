import { OfflineBanner } from "../../../components/offline-banner";
import { Button, EmptyState } from "../../../components/ui";
import { QuickScoutClient } from "./quick-scout-client";
import "../../scouting/scouting.css";
import "./quick-scout.css";

export const metadata = {
  title: "Scout a match",
};

export default async function QuickScoutPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <EmptyState title="Choose your team" description="Open Vantage to choose the team you are scouting for.">
          <Button as="a" variant="primary" href="/workspace?next=%2Fscout%2Fmatch">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  // The page's one <main> landmark: the client draws several shells (loading, picker, match).
  return (
    <main className="qs-page">
      <OfflineBanner feature="Match scouting" detail="Matches you save stay on this device and send when you are back online." />
      <QuickScoutClient key={orgId} orgId={orgId} />
    </main>
  );
}
