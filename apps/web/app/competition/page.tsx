import dynamic from "next/dynamic";

const CompetitionHub = dynamic(() => import("./competition-hub"));

export const metadata = {
  title: "Competition",
  description: "Event day, scouting, strategy, and pit.",
};

export default function CompetitionPage() {
  return <CompetitionHub />;
}
