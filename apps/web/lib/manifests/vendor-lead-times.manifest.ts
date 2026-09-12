export const manifest = {
  slug: "vendor-lead-times",
  title: "Lead times",
  route: "/vendor-lead-times",
  apiRoute: "/api/vendor-lead-times",
  hub: "Business",
  navGroup: "Business",
  metered: false,
  tables: ["vendor_lead_times_vendors", "vendor_lead_times_reorders"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
