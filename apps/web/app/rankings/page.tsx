import RankingsClient from "./rankings-client";
import "./rankings.css";

export const metadata = {
  title: "Rankings & Playoffs",
  description: "Event rankings with records and season rating, plus the elimination bracket — your team highlighted.",
};

export default function RankingsPage() {
  return <RankingsClient />;
}
