import ReportBugClient from "./report-bug-client";
import "./report-bug.css";

export const metadata = {
  title: "Report a bug",
  description: "Tell us what broke. One box, no ceremony — we read every report.",
};

export default function ReportBugPage() {
  return <ReportBugClient />;
}
