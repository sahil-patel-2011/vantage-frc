export const manifest = {
  slug: "skills-graph",
  title: "Skills & Mentorship Graph",
  route: "/skills-graph",
  apiRoute: "/api/skills-graph",
  hub: "Team",
  navGroup: "Team",
  metered: true,
  tables: ["skills_graph_entries", "skills_graph_mentor_requests"],
  aiTools: [
    {
      name: "skills_graph.mentor_matches",
      description: "Grounded read of declared team skills, completed-task evidence, and ranked mentor matches for open requests.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
