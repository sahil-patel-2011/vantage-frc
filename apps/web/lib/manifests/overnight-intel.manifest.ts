export const manifest = {
  slug: "overnight-intel",
  title: "Overnight brief",
  route: "/overnight-intel",
  apiRoute: "/api/overnight-intel",
  hub: "Competition",
  navGroup: "Competition",
  metered: true,
  tables: ["overnight_intel_briefs", "overnight_intel_epa_snapshots"],
  aiTools: [
    {
      name: "overnight_intel.latest_brief",
      description:
        "Grounded read of the org's most recent overnight event-intel brief — new research findings, EPA movers, and new scouting for the active event.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
