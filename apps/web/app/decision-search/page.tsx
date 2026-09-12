import DecisionSearchClient from "./decision-search-client";

export const metadata = {
  title: "Search",
  description:
    "Semantic search over indexed decisions, design reviews, and notebook entries. Metered search; links to Season report, Knowledge, and Strategy.",
};

export default function DecisionSearchPage() {
  return <DecisionSearchClient />;
}
