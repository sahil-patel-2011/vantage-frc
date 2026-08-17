export const manifest = {
  slug: "migrate",
  title: "Bring your season",
  route: "/migrate",
  apiRoute: "/api/migrate",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["import_connections", "calendar_inbound_feeds", "subteam_calendar_events", "knowledge_pages", "build_tasks", "attendance_events"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
