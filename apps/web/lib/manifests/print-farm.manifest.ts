export const manifest = {
  slug: "print-farm",
  title: "Print farm",
  route: "/print-farm",
  apiRoute: "/api/print-farm",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: [
    "print_farm_printers",
    "print_farm_filaments",
    "print_farm_jobs",
    "print_farm_filament_usage",
  ],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
