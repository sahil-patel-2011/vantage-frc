export const manifest = {
  slug: "battery-rotation",
  title: "Battery Rotation & Charge Planner",
  route: "/battery-rotation",
  apiRoute: "/api/battery-rotation",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["battery_rotation_batteries", "battery_rotation_readings", "battery_rotation_assignments"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
