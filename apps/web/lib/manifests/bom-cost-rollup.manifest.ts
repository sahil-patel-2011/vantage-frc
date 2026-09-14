export const manifest = {
  slug: "bom-cost-rollup",
  title: "BOM cost",
  route: "/bom-cost-rollup",
  apiRoute: "/api/bom-cost-rollup",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["bom_cost_rollup_line_items", "bom_cost_rollup_budgets"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
