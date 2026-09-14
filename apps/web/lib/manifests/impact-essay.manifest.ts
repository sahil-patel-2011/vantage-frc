export const manifest = {
  slug: "impact-essay",
  title: "Impact essay",
  route: "/impact-essay",
  apiRoute: "/api/impact-essay",
  hub: "Business",
  navGroup: "Business",
  metered: true,
  tables: ["impact_essay_drafts"],
  aiTools: [
    {
      name: "impact_essay.draft",
      description:
        "Read this org's grounded FIRST Impact / Engineering Inspiration essay drafts and the underlying record counts (outreach activities, build hours, sponsors, team events) each draft cites.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
