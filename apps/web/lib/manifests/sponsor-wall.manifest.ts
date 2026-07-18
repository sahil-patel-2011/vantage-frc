export const manifest = {
  slug: "sponsor-wall",
  title: "Sponsor Wall",
  route: "/sponsor-wall",
  apiRoute: "/api/sponsor-wall",
  hub: "Business",
  navGroup: "Business",
  metered: false,
  tables: ["sponsor_wall_entries", "sponsor_wall_settings"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
