import CalendarClient from "./calendar-client";
import "./calendar.css";

export const metadata = {
  title: "Season Calendar · Vantage",
  description: "Build-season milestones, countdowns, and done-tracking from Kickoff through competition.",
};

export default function CalendarPage() {
  return <CalendarClient />;
}
