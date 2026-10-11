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
  return <QuickScoutClient key={orgId} orgId={orgId} />;
}
