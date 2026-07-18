export const manifest = {
  slug: "equipment-maintenance",
  title: "Equipment Maintenance",
  route: "/equipment-maintenance",
  apiRoute: "/api/equipment-maintenance",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["equipment_maintenance_assets", "equipment_maintenance_logs"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
