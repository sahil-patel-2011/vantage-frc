import MatchDebriefClient from "./match-debrief-client";

export const metadata = {
  title: "Match Debrief",
};

export default async function MatchDebriefPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <MatchDebriefClient orgId={orgId ?? null} />;
}
