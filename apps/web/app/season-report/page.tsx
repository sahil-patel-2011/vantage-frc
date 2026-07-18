import SeasonReportClient from "./season-report-client";

export const metadata = {
  title: "Season Report · Vantage",
  description:
    "Soft-UI season retrospective from logged build, results, budget, and outreach notes — never DEMO season stats. Metered snapshots; links to Strategy and Impact.",
};

export default function SeasonReportPage() {
  return <SeasonReportClient />;
}
