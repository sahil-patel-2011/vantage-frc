export const manifest = {
  slug: "checklist-library",
  title: "Checklist Library",
  route: "/checklist-library",
  apiRoute: "/api/checklist-library",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["checklist_library_templates", "checklist_library_runs"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
