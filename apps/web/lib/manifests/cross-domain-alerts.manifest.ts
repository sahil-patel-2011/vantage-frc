export const manifest = {
  slug: "cross-domain-alerts",
  title: "Cross-Domain Alerts",
  route: "/cross-domain-alerts",
  apiRoute: "/api/cross-domain-alerts",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["cross_domain_alerts_subsystem_events", "cross_domain_alerts_acks"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
