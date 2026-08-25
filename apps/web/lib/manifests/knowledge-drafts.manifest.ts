export const manifest = {
  slug: "knowledge-drafts",
  title: "Knowledge Drafts",
  route: "/knowledge-drafts",
  apiRoute: "/api/knowledge-drafts",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: [
    "knowledge_capture_drafts",
    "knowledge_pages",
    "decision_records",
    "incident_reports",
    "pit_repair_triage_reports",
  ],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
