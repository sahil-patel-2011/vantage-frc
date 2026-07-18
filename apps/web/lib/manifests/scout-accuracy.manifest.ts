export const manifest = {
  slug: "scout-accuracy",
  title: "Scout Accuracy",
  route: "/scout-accuracy",
  apiRoute: "/api/scout-accuracy",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["scout_accuracy_snapshots", "scout_accuracy_promotions"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
