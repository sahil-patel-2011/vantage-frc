import BriefingClient from "./briefing-client";
import "./briefing.css";

export const metadata = {
  title: "Pre-Match Briefing · Vantage",
  description:
    "One pre-match card for the drive coach — prediction, game plan, whiteboard play, practice readiness, and opponent film.",
};

export default function BriefingPage() {
  return <BriefingClient />;
}
