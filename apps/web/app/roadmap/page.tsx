import RoadmapClient from "./roadmap-client";

export const metadata = {
  title: "Season roadmap · Vantage",
  description:
    "A dated kickoff-to-first-event checklist for FRC teams: registration, screening, funding, build milestones, inspection prep, pit setup, and safety — every date calculated from your own kickoff date.",
};

export default function RoadmapPage() {
  return <RoadmapClient />;
}
