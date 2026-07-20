import SearchClient from "./search-client";

export const metadata = {
  title: "Search · Vantage",
  description: "Search across build tasks, inventory, community impact, and team knowledge.",
};

export default function SearchPage() {
  return <SearchClient />;
}
