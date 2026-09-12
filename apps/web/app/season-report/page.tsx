import SeasonReportClient from "./season-report-client";

export const metadata = {
  title: "Season report",
  description:
    "Season retrospective from logged build, results, budget, and outreach notes. Metered snapshots; links to Strategy and Impact.",
};

export default function SeasonReportPage() {
  return <SeasonReportClient />;
}
