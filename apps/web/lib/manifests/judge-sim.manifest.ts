export const manifest = {
  slug: "judge-sim",
  title: "Judge pitch",
  route: "/judge-sim",
  apiRoute: "/api/judge-sim",
  hub: "Business",
  navGroup: "Business",
  metered: true,
  tables: ["judge_sim_evidence", "judge_sim_sessions"],
  aiTools: [
    {
      name: "judge_sim.sessions",
      description:
        "Read this org's graded judge Q&A practice sessions for the active season, including the question, category, verdict (well backed, partially backed, or unbacked), confidence, and any claims flagged as unbacked by logged evidence.",
    },
    {
      name: "judge_sim.evidence",
      description:
        "Read this org's logged judge-pitch evidence — the facts, numbers, and outcomes the team can point to when answering judging questions, grouped by category.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
