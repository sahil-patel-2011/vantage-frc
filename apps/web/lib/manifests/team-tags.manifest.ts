export const manifest = {
  slug: "team-tags",
  title: "Drive-team tags",
  route: "/team-tags",
  apiRoute: "/api/team-tags",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["qualitative_tag_defs", "qualitative_team_tags"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
