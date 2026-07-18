export const manifest = {
  slug: "decision-critic",
  title: "Decision Critic",
  route: "/decision-critic",
  apiRoute: "/api/decision-critic",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["decision_critic_reviews"],
  aiTools: [
    {
      name: "decision_critic.reviews",
      description:
        "Read this org's logged design-decision second opinions for the active season, including the verdict (proceed, proceed with caution, or reconsider), concerns grounded in weight/power headroom and FMEA failure history, confidence, and recorded outcome.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
