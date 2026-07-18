export const manifest = {
  slug: "field-reset-timer",
  title: "Field Reset Timer",
  route: "/field-reset-timer",
  apiRoute: "/api/field-reset-timer",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["field_reset_timer_sessions", "field_reset_timer_cycles"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
