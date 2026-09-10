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
        <h1>Select a workspace</h1>
        <p>
          Pit TV boards are saved per team. Select a workspace before creating a display layout.
        </p>
        <div className="disp-gate-actions">
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
          <a className="app-button secondary" href="/competition?tab=command">
            Event Day
          </a>
          <a className="app-button secondary" href="/competition?tab=strategy">
            Strategy
          </a>
        </div>
      </main>
    );
  }
  return <DisplaySetup orgId={orgId} />;
}
