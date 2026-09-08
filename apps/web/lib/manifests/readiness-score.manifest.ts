export const manifest = {
  slug: "readiness-score",
  title: "Robot Readiness Score",
  route: "/readiness-score",
  apiRoute: "/api/readiness-score",
  hub: "Build",
  navGroup: "Build",
  // Not metered: the readiness index is deterministic arithmetic over tables the
  // team already maintains — no model call, so it never touches the AI ledger.
  metered: false,
  // Owns only its bring-up checklist; every other column is read from the build
  // tool that owns it (see migration 0519).
  tables: ["readiness_score_checklist_items"],
  readsTables: [
    "robot_subsystems",
    "weight_components",
    "weight_settings",
    "power_loads",
    "subsystem_signoff_subsystems",
    "subsystem_signoff_records",
    "fmea_failures",
  ],
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
