import { Button, EmptyState } from "../../../components/ui";
import { QuickPitClient } from "./quick-pit-client";
import "../../scouting/scouting.css";
import "../match/quick-scout.css";

export const metadata = {
  title: "Pit scouting",
};

export default async function QuickPitPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <EmptyState title="Choose your team" description="Open Vantage to choose the team you are scouting for.">
          <Button as="a" variant="primary" href="/workspace?next=%2Fscout%2Fpit">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  // The page's one <main> landmark: the client draws several shells (loading, picker, form).
  return (
    <main className="qs-page">
      <QuickPitClient key={orgId} orgId={orgId} />
    </main>
  );
}
