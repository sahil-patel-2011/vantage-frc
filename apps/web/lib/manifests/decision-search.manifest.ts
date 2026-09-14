export const manifest = {
  slug: "decision-search",
  title: "Search",
  route: "/decision-search",
  apiRoute: "/api/decision-search",
  hub: "AI",
  navGroup: "AI",
  metered: true,
  tables: ["decision_search_documents", "decision_search_queries"],
  aiTools: [
    {
      name: "decision_search.search",
      description:
        "Grounded semantic search over the org's indexed decisions, design reviews, and notebook entries. Ranks by deterministic term overlap; never fabricates a match.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
