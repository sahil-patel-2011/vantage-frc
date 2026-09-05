import DutiesClient from "./duties-client";
import "./duties.css";

export const metadata = {
  title: "Duty roster",
  description: "Who still needs a scouting, pit, drive-team, or outreach assignment.",
};

export default function DutiesPage() {
  return <DutiesClient />;
}
