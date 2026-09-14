export const manifest = {
  slug: "grant-eligibility-matcher",
  title: "Eligibility",
  route: "/grant-eligibility-matcher",
  apiRoute: "/api/grant-eligibility-matcher",
  hub: "Business",
  navGroup: "Business",
  metered: false,
  tables: [
    "grant_eligibility_matcher_catalog",
    "grant_eligibility_matcher_profile",
    "grant_eligibility_matcher_matches",
  ],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
