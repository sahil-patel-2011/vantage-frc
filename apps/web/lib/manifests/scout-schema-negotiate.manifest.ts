export const manifest = {
  slug: "scout-schema-negotiate",
  title: "Schema sync",
  route: "/scout-schema-negotiate",
  apiRoute: "/api/scout-schema-negotiate",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["scout_schema_negotiate_versions", "scout_schema_negotiate_submissions"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
