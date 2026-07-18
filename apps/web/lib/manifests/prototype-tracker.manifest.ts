export const manifest = {
  slug: "prototype-tracker",
  title: "Prototype-to-Decision Tracker",
  route: "/prototype-tracker",
  apiRoute: "/api/prototype-tracker",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["prototype_tracker_tests", "prototype_tracker_decisions"],
  aiTools: [
    {
      name: "prototype_tracker.decisions",
      description:
        "Read this org's logged prototype tests (hypothesis, outcome, metric vs. target) and the decision records + notebook entries drafted from them, including recommendation (adopt, iterate, reject, needs more data) and confidence.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
