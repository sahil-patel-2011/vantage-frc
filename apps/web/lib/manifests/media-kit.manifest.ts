export const manifest = {
  slug: "media-kit",
  title: "Media kit",
  route: "/media-kit",
  apiRoute: "/api/media-kit",
  hub: "Business",
  navGroup: "Business",
  metered: true,
  tables: ["media_kit_profiles", "media_kit_assets", "media_kit_documents"],
  aiTools: [
    {
      name: "media_kit.profile",
      description:
        "Read this org's recorded media-kit team profile for a season — mission statement, bio, founded year, achievements, and contact info.",
    },
    {
      name: "media_kit.one_pagers",
      description:
        "Read this org's generated media-kit one-pager documents for a season, built only from the recorded profile and asset library.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
