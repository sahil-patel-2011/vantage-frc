import ScheduleClient from "./schedule-client";
import "./schedule.css";

export const metadata = {
  title: "Match Schedule · Vantage",
  description: "Every match at the active event — your matches highlighted, results, and scout coverage.",
};

export default function SchedulePage() {
  return <ScheduleClient />;
}
