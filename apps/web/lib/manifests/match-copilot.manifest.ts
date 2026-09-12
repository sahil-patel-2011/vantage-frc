export const manifest = {
  slug: "match-copilot",
  title: "Briefing",
  route: "/match-copilot",
  apiRoute: "/api/match-copilot",
  hub: "Competition",
  navGroup: "Competition",
  metered: true,
  tables: ["match_copilot_briefs"],
  aiTools: [
    {
      name: "match_copilot.brief",
      description:
        "Grounded read of the next-match brief: opponent scouting and season ratings, our stored strategy plan, open failure risks, and battery fleet health fused into prioritized do-this callouts.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
