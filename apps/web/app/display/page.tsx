import { Button } from "../../components/ui";
import DisplaySetup from "./setup-client";
import "./display.css";

export const metadata = {
  title: "Display Mode",
  description:
    "Build a single pit-TV board from TBA schedule and Strategy predictions. No demo filler.",
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
        <span className="eyebrow">VANTAGE / DISPLAY</span>
        <h1>Choose your team</h1>
        <p>
          Pit TV boards are saved per team. Choose your team before creating a display layout.
        </p>
        <div className="disp-gate-actions">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
          <Button as="a" variant="secondary" href="/competition?tab=command">
            Event Day
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
