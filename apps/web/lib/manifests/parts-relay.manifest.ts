export const manifest = {
  slug: "parts-relay",
  title: "Parts relay",
  route: "/parts-relay",
  apiRoute: "/api/parts-relay",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["parts_relay_listings", "parts_relay_loans"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
