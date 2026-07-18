import AttendanceClient from "./attendance-client";
import "./attendance.css";

export const metadata = {
  title: "Attendance · Vantage",
  description: "Log practice and meeting attendance with credited hours — real marks only.",
};

export default function AttendancePage() {
  return <AttendanceClient />;
}
