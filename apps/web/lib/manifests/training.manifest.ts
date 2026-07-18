export const manifest = {
  slug: "training",
  title: "Training Matrix",
  route: "/training",
  apiRoute: "/api/training",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["training_skills", "training_certifications"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
