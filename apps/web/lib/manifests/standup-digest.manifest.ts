export const manifest = {
  slug: "standup-digest",
  title: "Morning Standup Digest",
  route: "/standup-digest",
  apiRoute: "/api/standup-digest",
  hub: "Team",
  navGroup: "Team",
  metered: true,
  tables: ["standup_digest_runs", "standup_digest_notes"],
  aiTools: [
    {
      name: "standup_digest.brief",
      description:
        "Read this org's compiled morning standup digest for a given date: logged hours, task movement (completed/blocked/created), open blockers, attendance, and knowledge-page edits, grouped by subteam.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
