export const manifest = {
  slug: "rule-impact",
  title: "Rule Impact Analyzer",
  route: "/rule-impact",
  apiRoute: "/api/rule-impact",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["rule_impact_rule_changes", "rule_impact_assessments"],
  aiTools: [
    {
      name: "rule_impact.assessments",
      description:
        "Read this org's kickoff rule-change log and the resulting still-legal/needs-rework/blocked impact assessments for prior-season subsystems in the active design season, grounded only in logged rule changes matched to the subsystem library.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
