export const manifest = {
  slug: "event-readiness",
  title: "Event Readiness",
  route: "/event-readiness",
  apiRoute: "/api/event-readiness",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["event_readiness_plans", "event_readiness_items"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
