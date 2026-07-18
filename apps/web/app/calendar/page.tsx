import CalendarClient from "./calendar-client";
import "./calendar.css";

export const metadata = {
  title: "Season Calendar · Vantage",
  description: "Opt-in FRC season milestone templates — kickoff, stop-build, events, ship deadlines, outreach — with editable markers.",
};

export default function CalendarPage() {
  return <CalendarClient />;
}
