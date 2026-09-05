import TeamCalendarClient from "./team-calendar-client";
import "./team-calendar.css";

export const metadata = {
  title: "Team Calendar",
  description: "Subteam calendars for practices, build sessions, deadlines, and events — filter by group or view the whole team.",
};

export default function TeamCalendarPage() {
  return <TeamCalendarClient />;
}
