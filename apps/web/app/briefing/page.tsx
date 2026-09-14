import BriefingClient from "./briefing-client";
import "./briefing.css";

export const metadata = {
  title: "Pre-match briefing",
  description:
    "The one pre-match briefing — prediction, game plan, match card, scouted tendencies, opponent notes, defense plan, robot health, practice readiness, and film for one match.",
};

export default function BriefingPage() {
  return <BriefingClient />;
}
