export const manifest = {
  slug: "safety-training",
  title: "Safety Training Tracker",
  route: "/safety-training",
  apiRoute: "/api/safety-training",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["safety_training_modules", "safety_training_completions"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
