export const manifest = {
  slug: "pairwise",
  title: "Pairwise",
  route: "/pairwise",
  apiRoute: "/api/pairwise",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["qualitative_criteria", "pairwise_comparisons"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
