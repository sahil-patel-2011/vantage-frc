export const manifest = {
  slug: "picklist-justifier",
  title: "Pick-list Auto-Justifier",
  route: "/picklist-justifier",
  apiRoute: "/api/picklist-justifier",
  hub: "Competition",
  navGroup: "Competition",
  metered: true,
  tables: ["picklist_justifier_justifications"],
  aiTools: [
    {
      name: "picklist_justifier.entries",
      description:
        "Read this org's generated pick-list justifications (source-cited rationale + TBA contradiction flags) for a pick list.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
