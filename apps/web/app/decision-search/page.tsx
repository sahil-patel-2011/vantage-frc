import DecisionSearchClient from "./decision-search-client";

export const metadata = {
  title: "Decision Search · Vantage",
  description:
    "Soft-UI semantic search over indexed decisions, design reviews, and notebook entries — never DEMO decisions. Metered search; links to Season Report, Knowledge, and Strategy.",
};

export default function DecisionSearchPage() {
  return <DecisionSearchClient />;
}
