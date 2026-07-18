export const manifest = {
  slug: "inspection-copilot",
  title: "Inspection-Readiness Copilot",
  route: "/inspection-copilot",
  apiRoute: "/api/inspection-copilot",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["inspection_copilot_checks"],
  aiTools: [
    {
      name: "inspection_copilot.checks",
      description:
        "Read this org's inspection-readiness checks for the active season, including predicted failures (weight over limit, out-of-range bumper height/thickness, exceeded frame perimeter, oversized main breaker, unsecured battery, unlabeled wiring, radio power/bypass-switch faults) with risk score.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
