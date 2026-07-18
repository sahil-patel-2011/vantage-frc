export const manifest = {
  slug: "budget-reconciler",
  title: "Budget Reconciler",
  route: "/budget-reconciler",
  apiRoute: "/api/budget-reconciler",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["budget_reconciler_reports"],
  aiTools: [
    {
      name: "budget_reconciler.reports",
      description:
        "Read this org's weight/power budget reconciliation runs for the active season — as-designed mass vs. weight limit, current draw vs. summed breaker budget, drift status, and the proposed subsystem to trim with amount and rationale.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
