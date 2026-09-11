export const manifest = {
  slug: "scout-p2p-relay",
  title: "Pit mesh",
  route: "/scout-p2p-relay",
  apiRoute: "/api/scout-p2p-relay",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["scout_p2p_relay_sessions", "scout_p2p_relay_entries"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
