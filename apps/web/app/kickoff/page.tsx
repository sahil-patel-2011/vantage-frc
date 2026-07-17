import KickoffClient from "./kickoff-client";
import "./kickoff.css";

export const metadata = {
  title: "Kickoff & Game Analysis · Vantage",
  description: "Break the new game into scoring actions, rank them by value, and turn them into design priorities.",
};

export default function KickoffPage() {
  return <KickoffClient />;
}
