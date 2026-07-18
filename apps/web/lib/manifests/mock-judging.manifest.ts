export const manifest = {
  slug: "mock-judging",
  title: "Mock Judging",
  route: "/mock-judging",
  apiRoute: "/api/mock-judging",
  hub: "Team",
  navGroup: "Team",
  metered: true,
  tables: ["mock_judging_prep_notes", "mock_judging_sessions"],
  aiTools: [
    {
      name: "mock_judging.sessions",
      description:
        "Read this org's rubric-scored mock judging practice sessions for the active season, including the award category, question, answer, per-criterion scores (substance, specificity, evidence grounding, clarity, confidence), strengths, and improvement suggestions.",
    },
    {
      name: "mock_judging.prep_notes",
      description:
        "Read this org's logged mock-judging prep notes — the talking points and facts the team can point to for judges, grouped by award category.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
