export const manifest = {
  slug: "code-perf",
  title: "Code vs match",
  route: "/code-perf",
  apiRoute: "/api/code-perf",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["code_perf_changes", "code_perf_match_results"],
  aiTools: [
    {
      name: "code_perf.changes",
      description:
        "Read this org's logged commits/software-version/tuning changes for the active season, including the computed before/after match-window correlation (verdict, delta auto/teleop points, rationale).",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
