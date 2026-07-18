import TeamDataClient from "./team-data-client";
import "./team-data.css";

export const metadata = {
  title: "Team data · Vantage",
  description: "Live TBA cache health, inventory counts, and audited exports for your workspace.",
};

export default async function TeamDataPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="soft-gate content">
        <span className="eyebrow">Team data</span>
        <h1>Select a workspace</h1>
        <p>Open Team data from a team workspace so analytics stay scoped to the right organization.</p>
        <a href="/dashboard">Go to Home</a>
      </main>
    );
  }
  return <TeamDataClient orgId={orgId} />;
}