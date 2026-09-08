import KickoffClient from "./kickoff-client";
import "./kickoff.css";

export const metadata = {
  title: "Kickoff & Game Analysis",
  description:
    "Ingest the FRC game manual and kickoff transcript, structure the season summary, then seed design priorities and a CAD brief.",
};

export default function KickoffPage() {
  return <KickoffClient />;
}
