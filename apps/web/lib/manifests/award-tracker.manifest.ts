export const manifest = {
  slug: "award-tracker",
  title: "Award Submission Tracker",
  route: "/award-tracker",
  apiRoute: "/api/award-tracker",
  hub: "Business",
  navGroup: "Business",
  metered: false,
  tables: ["award_tracker_submissions"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
