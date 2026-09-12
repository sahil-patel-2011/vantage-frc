export const manifest = {
  slug: "bin-shelf-locator",
  title: "Bin locator",
  route: "/bin-shelf-locator",
  apiRoute: "/api/bin-shelf-locator",
  hub: "Build",
  navGroup: "Logistics",
  metered: false,
  tables: ["bin_shelf_locator_locations", "bin_shelf_locator_item_locations", "bin_shelf_locator_moves"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
