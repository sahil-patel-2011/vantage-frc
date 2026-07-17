import RankingsClient from "./rankings-client";
import "./rankings.css";

export const metadata = {
  title: "Rankings & Playoffs · Vantage",
  description: "Event rankings with records and EPA, plus the elimination bracket — your team highlighted.",
};

export default function RankingsPage() {
  return <RankingsClient />;
}
