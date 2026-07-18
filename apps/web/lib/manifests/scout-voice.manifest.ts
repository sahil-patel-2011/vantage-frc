export const manifest = {
  slug: "scout-voice",
  title: "Scout Voice Notes",
  route: "/scouting",
  apiRoute: "/api/scout-voice",
  hub: "Competition",
  navGroup: "Competition",
  metered: true,
  tables: ["scout_voice_org_settings", "scout_voice_user_prefs", "scout_voice_notes"],
  aiTools: ["scout_voice_stt"],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
