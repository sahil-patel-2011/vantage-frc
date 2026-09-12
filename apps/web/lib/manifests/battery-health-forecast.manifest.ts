export const manifest = {
  slug: "battery-health-forecast",
  title: "Pack health",
  route: "/battery-health-forecast",
  apiRoute: "/api/battery-health-forecast",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["battery_health_forecast_batteries", "battery_health_forecast_readings"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
