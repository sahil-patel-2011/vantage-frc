export const manifest = {
  slug: "sponsor-renewal-roi",
  title: "Sponsor Renewal ROI",
  route: "/sponsor-renewal-roi",
  apiRoute: "/api/sponsor-renewal-roi",
  hub: "Business",
  navGroup: "Business",
  metered: true,
  tables: ["sponsor_renewal_roi_scores", "sponsor_renewal_roi_reports"],
  aiTools: [
    {
      name: "sponsor_renewal_roi.reports",
      description:
        "Read this org's sponsor renewal-risk scores and generated ROI reports, grounded only in logged sponsor interactions, contributions, and community-impact mentions.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
