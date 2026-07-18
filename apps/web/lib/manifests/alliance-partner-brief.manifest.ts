export const manifest = {
  slug: "alliance-partner-brief",
  title: "Alliance-Partner Brief",
  route: "/alliance-partner-brief",
  apiRoute: "/api/alliance-partner-brief",
  hub: "Competition",
  navGroup: "Competition",
  metered: true,
  tables: ["alliance_partner_brief_briefs"],
  aiTools: [
    {
      name: "alliance_partner_brief.brief",
      description:
        "Read this org's generated alliance-partner brief (role, strengths, evidence) for a finalized alliance seed at an event.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
