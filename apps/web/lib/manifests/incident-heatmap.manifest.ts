export const manifest = {
  slug: "incident-heatmap",
  title: "Incidents",
  route: "/incident-heatmap",
  apiRoute: "/api/incident-heatmap",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["incident_heatmap_incidents"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
