import RankingProjectionClient from "./ranking-projection-client";

export const metadata = {
  title: "Ranking projection",
  description: "Remaining qualification matches against your cached TBA rank — never DEMO ranks.",
};

export default function RankingProjectionPage() {
  return <RankingProjectionClient />;
}
