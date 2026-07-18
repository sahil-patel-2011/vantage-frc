export const manifest = {
  slug: "readiness-score",
  title: "Robot Readiness Score",
  route: "/readiness-score",
  apiRoute: "/api/readiness-score",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["readiness_score_subsystems", "readiness_score_checklist_items"],
  aiTools: [
    {
      name: "readiness_score.index",
      description:
        "Read this org's grounded ship-readiness index for the active season: subsystem wiring + code-version state, weight/power headroom against FRC budgets, bring-up checklist completion, open FMEA clearance, and the severity-ordered fix list.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
