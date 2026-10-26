import RankingProjectionClient from "./ranking-projection-client";

export const metadata = {
  title: "Ranking projection",
  description: "Where your team is likely to finish, from the matches already saved for this event.",
};

export default function RankingProjectionPage() {
  return <RankingProjectionClient />;
}
