import CompetitionTeams from "../../competition/competition-teams";
import { PageHeader, EmptyState, Button } from "../../../components/ui";

export const metadata = {
  title: "Teams",
};

export default async function ScoutTeamsPage({ searchParams }: { searchParams: Promise<{orgId?: string}> }) {
  const {orgId} = await searchParams;
  return <main className="module-page scout-teams-page">
    <PageHeader title="Teams" description="Compare the robots your scouts observed and find your next alliance partner." />
    {orgId ? <CompetitionTeams key={orgId} orgId={orgId} /> : <EmptyState title="Choose your team" description="Open Vantage to choose the team whose scouting you want to see."><Button as="a" href="/dashboard">Open Vantage</Button></EmptyState>}
  </main>;
}
