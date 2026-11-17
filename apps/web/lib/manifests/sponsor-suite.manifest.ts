export const manifest = {
  slug: "sponsor-suite",
  title: "Sponsor suite",
  route: "/sponsor-suite",
  apiRoute: "/api/sponsor-suite",
  hub: "Business",
  navGroup: "Business",
  metered: true,
  tables: ["sponsor_suite_goals", "sponsor_suite_decks", "sponsor_suite_roi_reports", "sponsor_suite_reminders"],
  aiTools: [
    {
      name: "sponsor_suite.roi_reports",
      description:
        "Read this org's end-of-season sponsor ROI reports for a season — total raised, per-sponsor contribution lines, and progress against the season fundraising goal.",
    },
    {
      name: "sponsor_suite.goal_progress",
      description:
        "Read this org's season fundraising goal vs. actual raised, computed live from recorded sponsor contributions.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
