export const manifest = {
  slug: "alumni-network",
  title: "Alumni",
  route: "/alumni-network",
  apiRoute: "/api/alumni-network",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["alumni_network_profiles", "alumni_network_mentor_slots"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
