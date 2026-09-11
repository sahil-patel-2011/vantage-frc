export type EmptyHint = {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
};

/** Empty / setup copy a new student can act on — team, not workspace; no EPA / org / TBA-sync jargon. */
export const WIDGET_EMPTY_COPY: Record<string, EmptyHint> = {
  next_match: {
    title: "No upcoming match",
    body: "Shows the next scheduled match once match data is connected.",
    ctaHref: "/my-day",
    ctaLabel: "Open My Day",
  },
  recent_result: {
    title: "No scored matches",
    body: "Results appear after the team connects match data.",
    ctaHref: "/command",
    ctaLabel: "Set active event",
  },
  competition_snapshot: {
    title: "No snapshot",
    body: "Rank and record need an active event plus connected match data.",
    ctaHref: "/command",
    ctaLabel: "Set active event",
  },
  scouting_coverage: {
    title: "No coverage yet",
    body: "Assignments appear after the event is set.",
    ctaHref: "/scouting",
    ctaLabel: "Open scouting",
  },
  prediction_summary: {
    title: "No prediction yet",
    body: "Needs a schedule and team scores from this event.",
    ctaHref: "/strategy",
    ctaLabel: "Open Strategy",
  },
  sync_status: {
    title: "Match data not connected",
    body: "Connect The Blue Alliance so match cards can fill in.",
    ctaHref: "/team/data",
    ctaLabel: "Connect TBA",
  },
  pit_youtube: {
    title: "No pit stream",
    body: "Add a YouTube URL in Displays.",
    ctaHref: "/display",
    ctaLabel: "Open displays",
  },
  ai_usage: {
    title: "AI usage unavailable",
    body: "Ask a team admin to open this card.",
    ctaHref: "/team",
    ctaLabel: "Team settings",
  },
  notifications: {
    title: "No notifications",
    body: "Alerts appear when they are sent.",
    ctaHref: "/notifications",
    ctaLabel: "Open notifications",
  },
  robot_readiness: {
    title: "No checklist data",
    body: "Add robot checks from the pit board.",
    ctaHref: "/pit",
    ctaLabel: "Open pit",
  },
  alerts: {
    title: "No new alerts",
    body: "Team alerts list here when they exist.",
    ctaHref: "/scouting",
    ctaLabel: "Open scouting",
  },
  team_todos: {
    title: "No open todos",
    body: "Team todos appear when someone on the team adds them.",
    ctaHref: "/todos",
    ctaLabel: "Open todos",
  },
  subteam_upcoming: {
    title: "Nothing upcoming",
    body: "Schedule a practice to see the next session.",
    ctaHref: "/team/calendar",
    ctaLabel: "Open calendar",
  },
  my_day: {
    title: "Nothing on your day yet",
    body: "Your next match and leave time show up after match data is connected.",
    ctaHref: "/my-day",
    ctaLabel: "Open My Day",
  },
  learn_progress: {
    title: "No learning track started",
    body: "Open Learn CAD or programming setup.",
    ctaHref: "/cad-learn",
    ctaLabel: "Learn CAD",
  },
  files_recent: {
    title: "No files yet",
    body: "Open Files to add one.",
    ctaHref: "/files",
    ctaLabel: "Open Files",
  },
  team_chat: {
    title: "No unread chats",
    body: "Team messages show up here.",
    ctaHref: "/messages",
    ctaLabel: "Open chat",
  },
  duties: {
    title: "Nothing to assign",
    body: "Duties appear when a session needs people.",
    ctaHref: "/logistics",
    ctaLabel: "Open logistics",
  },
  budget_parts: {
    title: "No budget or part requests",
    body: "Open Money to add a budget or review requests.",
    ctaHref: "/business?tab=finance",
    ctaLabel: "Open Money",
  },
  ask_ai: {
    title: "Ask AI",
    body: "Type a question. It uses your team's facts and says when it does not know.",
    ctaHref: "/ai?tab=chat",
    ctaLabel: "Ask AI",
  },
  quick_actions: {
    title: "Get set up",
    body: "Choose your team, set the active event, then connect match data.",
  },
  onboarding_checklist: {
    title: "Finish setup",
    body: "Choose your team, set the active event, then connect match data.",
    ctaHref: "/command",
    ctaLabel: "Set active event",
  },
  attendance: {
    title: "No session tonight",
    body: "Attendance shows up after a practice or meeting is on the calendar.",
    ctaHref: "/team/calendar",
    ctaLabel: "Open calendar",
  },
  outreach_hours: {
    title: "No outreach hours",
    body: "Log outreach hours after an event.",
    ctaHref: "/business?tab=evidence",
    ctaLabel: "Open outreach",
  },
  announcements_ack: {
    title: "Nothing to acknowledge",
    body: "Announcements that need a read-receipt show up here.",
    ctaHref: "/announcements",
    ctaLabel: "Open announcements",
  },
  event_countdown: {
    title: "No upcoming event",
    body: "Set an active event to see the countdown.",
    ctaHref: "/command",
    ctaLabel: "Set active event",
  },
  hours_month: {
    title: "No hours this month",
    body: "Clock in from Hours after a session.",
    ctaHref: "/hours",
    ctaLabel: "Open hours",
  },
  calendar_today: {
    title: "Nothing on the calendar",
    body: "Add a practice or meeting to see today.",
    ctaHref: "/team/calendar",
    ctaLabel: "Open calendar",
  },
  cad_resources: {
    title: "No CAD files yet",
    body: "Paste an Onshape link or open the vault.",
    ctaHref: "/cad",
    ctaLabel: "Open CAD",
  },
  coding_resources: {
    title: "No robot-code repo",
    body: "Connect GitHub from Connectors to see the repo and findings.",
    ctaHref: "/code",
    ctaLabel: "Open code",
  },
  team_profile: {
    title: "Team profile not built",
    body: "Open Team profile to load what match data has on record.",
    ctaHref: "/team/profile",
    ctaLabel: "Open profile",
  },
  alliance_desk: {
    title: "Alliance desk idle",
    body: "Alliance selection opens at the event.",
    ctaHref: "/alliance-selection-desk",
    ctaLabel: "Open alliance desk",
  },
  match_schedule: {
    title: "No match schedule",
    body: "Connect match data or paste a schedule.",
    ctaHref: "/schedule",
    ctaLabel: "Open schedule",
  },
  batteries: {
    title: "No batteries logged",
    body: "Add a battery from pit tools.",
    ctaHref: "/pit",
    ctaLabel: "Open pit",
  },
  assembly_manual: {
    title: "No assembly manual",
    body: "Start one from an Onshape assembly.",
    ctaHref: "/assembly-manual",
    ctaLabel: "Open assembly manual",
  },
  sponsor_followups: {
    title: "No sponsor follow-ups",
    body: "Open Sponsors to log the next step.",
    ctaHref: "/business?tab=sponsors",
    ctaLabel: "Open sponsors",
  },
  event_readiness: {
    title: "No event on the calendar",
    body: "Set an active event to see packing and travel.",
    ctaHref: "/command",
    ctaLabel: "Set active event",
  },
  weather_venue: {
    title: "No venue weather",
    body: "Weather appears when an event with a location is active.",
    ctaHref: "/command",
    ctaLabel: "Set active event",
  },
};

export function emptyHintFor(type: string): EmptyHint {
  return (
    WIDGET_EMPTY_COPY[type] ?? {
      title: "Nothing yet",
      body: "Finish team and event setup.",
    }
  );
}
