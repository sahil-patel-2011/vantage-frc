export const manifest = {
  slug: "season-finance",
  title: "Season finance desk",
  route: "/business?tab=finance",
  apiRoute: "/api/business/finance",
  hub: "Business",
  navGroup: "Business",
  metered: false,
  tables: ["finance_funding_sources", "finance_purchase_log"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
