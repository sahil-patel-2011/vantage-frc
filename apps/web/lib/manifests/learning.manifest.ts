export const manifest = {
  slug: "learning",
  title: "Learning",
  route: "/learning",
  apiRoute: "/api/learning/mentor",
  hub: "Team",
  navGroup: "Team",
  // The optional coach paragraph on a revealed call runs through meteredAI
  // (feature: learning_coach); the foreman view itself is pure SQL.
  metered: true,
  tables: ["learning_predictions", "learning_mode_prefs"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
