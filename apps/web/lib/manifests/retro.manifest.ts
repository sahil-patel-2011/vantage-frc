export const manifest = {
  slug: "retro",
  title: "Team Retrospective",
  route: "/retro",
  apiRoute: "/api/retro",
  hub: "Team",
  navGroup: "Team",
  metered: true,
  tables: ["retro_sessions", "retro_items", "retro_item_votes", "retro_action_items", "retro_postmortems"],
  aiTools: [
    {
      name: "retro.postmortem",
      description:
        "Read this org's auto-compiled season postmortem: counted decisions, risks, safety incidents, and FMEA failures, plus retro action-item follow-through, with a grounded narrative summary.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
