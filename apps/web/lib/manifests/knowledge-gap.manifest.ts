export const manifest = {
  slug: "knowledge-gap",
  title: "Knowledge-gap detective",
  route: "/knowledge-gap",
  apiRoute: "/api/knowledge-gap",
  hub: "Team",
  navGroup: "Team",
  metered: true,
  tables: ["knowledge_gap_scans", "knowledge_gap_items"],
  aiTools: [
    {
      name: "knowledge_gap.scan_summary",
      description:
        "Grounded read of the latest knowledge-gap scan for the org's active season: coverage score and the list of undocumented subsystems/decisions/events, with no invented rows.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
