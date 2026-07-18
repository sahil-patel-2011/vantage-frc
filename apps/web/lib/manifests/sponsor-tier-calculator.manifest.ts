export const manifest = {
  slug: "sponsor-tier-calculator",
  title: "Sponsor Tier Calculator",
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
