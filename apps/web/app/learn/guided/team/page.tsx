import { TeamProgressClient } from "./team-progress-client";
import "../guided.css";

export const metadata = {
  title: "Team progress",
  description: "Every member's checked steps on the guided tracks, and the sign-offs waiting on a lead.",
};

export default function GuidedTeamProgressPage() {
  return <TeamProgressClient />;
}
