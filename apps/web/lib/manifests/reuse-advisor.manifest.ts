export const manifest = {
  slug: "reuse-advisor",
  title: "Reuse Advisor",
  route: "/reuse-advisor",
  apiRoute: "/api/reuse-advisor",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["reuse_advisor_assessments"],
  aiTools: [
    {
      name: "reuse_advisor.assessments",
      description:
        "Read this org's cross-season subsystem reuse assessments for the active design season, including the prior-season failure-history + design-review-track-record grounded recommendation (reuse, modify, or avoid), confidence, and rationale.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
