import PracticeClient from "./practice-client";
import "./practice.css";

export const metadata = {
  title: "Practice Planner · Vantage",
  description: "Plan drive-team practice sessions, set goals, log cycle times, and link attendance or build tasks.",
};

export default function PracticePage() {
  return <PracticeClient />;
}
