import DisplaySetup from "./setup-client";
import "./display.css";

export const metadata = {
  title: "Display Mode · Vantage",
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
      <main className="display-gate">
        <span className="eyebrow">VANTAGE / DISPLAY</span>
        <h1>Select a workspace</h1>
        <p>
          Pit TV boards are saved per team. Select a workspace before creating a display layout —
          nothing is pre-filled with DEMO matches or ranks.
        </p>
        <a href="/workspace">Select workspace</a>
      </main>
    );
  }
  return <DisplaySetup orgId={orgId} />;
}
