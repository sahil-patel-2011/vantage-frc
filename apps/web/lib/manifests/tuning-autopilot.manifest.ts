export const manifest = {
  slug: "tuning-autopilot",
  title: "Tuning advisor",
  route: "/tuning-autopilot",
  apiRoute: "/api/tuning-autopilot",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["tuning_autopilot_sessions", "tuning_autopilot_iterations"],
  aiTools: [
    {
      name: "tuning_autopilot.sessions",
      description:
        "Read this org's logged gain-set tuning sessions for the active season, including each iteration's gain set, observed test result (overshoot, settling time, steady-state error, oscillation), and the deterministic next-gain suggestion derived from that session's own logged trend.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
