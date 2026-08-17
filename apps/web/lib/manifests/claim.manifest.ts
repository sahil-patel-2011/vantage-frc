export const manifest = {
  slug: "claim",
  title: "Claim FRC team",
  route: "/claim",
  apiRoute: "/api/organizations/claim",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["organizations", "memberships"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
