export const manifest = {
  slug: "wiring-diagnoser",
  title: "Wiring check",
  route: "/wiring-diagnoser",
  apiRoute: "/api/wiring-diagnoser",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["wiring_diagnoser_checks"],
  aiTools: [
    {
      name: "wiring_diagnoser.checks",
      description:
        "Read this org's wiring-diagram vs board-observation checks for the active season, including flagged miswires, undersized breakers, wire-undersized-for-breaker faults, and over-spec channels with risk score.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
