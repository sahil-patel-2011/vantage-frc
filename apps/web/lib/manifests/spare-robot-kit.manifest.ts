export const manifest = {
  slug: "spare-robot-kit",
  title: "Spare Robot Kit Checklist",
  route: "/spare-robot-kit",
  apiRoute: "/api/spare-robot-kit",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["spare_robot_kit_checklists"],
  aiTools: [
    {
      name: "spare_robot_kit.checklists",
      description:
        "Read this org's competition spare-parts kit checklists for the active season — candidate items derived from crossing inventory spare bins against logged repeat-failure history, with pack priority, recommended quantity, and pack status.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
