import { Button } from "../../components/ui";
import DisplaySetup from "./setup-client";
import "./display.css";

export const metadata = {
  title: "Pit TV",
  description: "Pick what the pit TV shows, save it, then open the TV link on the TV.",
};

export default async function DisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page display-setup display-gate">
        <span className="eyebrow">COMPETITION / PIT / PIT TV</span>
        <h1>Choose your team</h1>
        <p>
          Pit TV boards are saved per team. Choose your team first.
        </p>
        <div className="disp-gate-actions">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
          <Button as="a" variant="secondary" href="/competition?tab=command">
            Event day
          </Button>
          <Button as="a" variant="secondary" href="/competition?tab=strategy">
            Strategy
          </Button>
        </div>
      </main>
    );
  }
  return <DisplaySetup orgId={orgId} />;
}
