import { TeamLessonsClient } from "./team-lessons-client";
import "./team-lessons.css";

export const metadata = {
  title: "Team resources",
  description: "Step-by-step lessons your team wrote, each ending in practice questions Vantage checks.",
};

export default function TeamLessonsPage() {
  return <TeamLessonsClient />;
}
