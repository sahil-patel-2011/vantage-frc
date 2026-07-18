export const manifest = {
  slug: "grant-report",
  title: "Grant Report",
  route: "/grant-report",
  apiRoute: "/api/grant-report",
  hub: "Business",
  navGroup: "Business",
  metered: true,
  tables: ["grant_report_reports"],
  aiTools: [
    {
      name: "grant_report.reports",
      description:
        "Read this org's generated post-grant impact reports — award amount, recorded outreach to the funder, and recorded fund usage by category, grounded only in logged data.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
