export const manifest = {
  slug: "meeting-autopilot",
  title: "Meeting-Agenda Autopilot",
  route: "/meeting-autopilot",
  apiRoute: "/api/meeting-autopilot",
  hub: "Team",
  navGroup: "Team",
  metered: true,
  tables: ["meeting_autopilot_agendas", "meeting_autopilot_action_items"],
  aiTools: [
    {
      name: "meeting_autopilot.agenda",
      description:
        "Read-only: the ranked meeting agenda grounded in open blockers, overdue tasks, unresolved decisions, and open Failure log for the org's active season.",
    },
    {
      name: "meeting_autopilot.action_items",
      description: "Read-only: action items deterministically drafted from a meeting's post-meeting minutes.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
