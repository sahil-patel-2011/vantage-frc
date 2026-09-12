export const manifest = {
  slug: "sponsor-tier-calculator",
  title: "Tier calculator",
  route: "/sponsor-tier-calculator",
  apiRoute: "/api/sponsor-tier-calculator",
  hub: "Business",
  navGroup: "Business",
  metered: false,
  tables: ["sponsor_tier_calculator_tiers", "sponsor_tier_calculator_fulfillments"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
