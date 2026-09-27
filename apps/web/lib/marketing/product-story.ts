/**
 * Public marketing copy. Shared descriptions for the public workspace catalog.
 *
 * The story is "one place for everything an FRC team does, and it teaches new
 * members on the way in". Optional AI accompanies the core team workflows. The four entries in
 * MARKETING_HUBS are the four workspaces a signed-in member sees
 * (lib/nav/hubs.ts NAV_HUBS); keep them in sync by hand when a team
 * changes.
 */

/** What a new student can do with one login — no dashboard dump, no fake counts. */
export const MARKETING_STUDENT_PATH = [
  {
    title: "Scout a match",
    copy: "Match and pit forms stay on the tablet when the venue Wi-Fi dies, then sync when you are back online.",
  },
  {
    title: "Learn CAD",
    copy: "Follow CAD lessons and video guidance, save learning progress, and connect an Onshape document for design work.",
  },
  {
    title: "Talk with the team",
    copy: "Use team channels and direct messages, with access based on membership and channel permissions.",
  },
  {
    title: "Run practice",
    copy: "Hours, packing, pit checklists, chat and practice roll calls, for everyone on your team.",
  },
] as const;

export const MARKETING_HUBS = [
  {
    id: "team",
    icon: "users" as const,
    title: "Team",
    href: "/features#team",
    route: "/team",
    promise: "Plan the week, assign work and keep decisions with the people who need them.",
    modules: ["Calendar", "Chat", "People", "Work", "Logistics", "Playbook"],
    tools: [
      "Calendar, tasks, ownership, due dates and dependencies",
      "Team documents and member spaces, subject to access permissions",
      "Team chat and DMs that stay with the team, not on someone's phone",
      "Hours, attendance, roles, and outreach hours by person",
      "Playbook: the wiki, season roadmap, decision notes, and a writer for grants and updates",
    ],
  },
  {
    id: "build",
    icon: "wrench" as const,
    title: "Build",
    href: "/features#build",
    route: "/build",
    promise: "Bring learning, CAD connections, code review and robot records into the build process.",
    modules: ["Kickoff", "CAD", "Code", "Robot"],
    tools: [
      "CAD lessons, exercises, saved progress and mentor feedback",
      "Rookie training: a programming track and a mechanical track, paced week by week from official docs",
      "Programming setup: Git, VS Code, WPILib and PathPlanner with real download links, plus the GitHub Student Pack walk-through",
      "Onshape links, a record of what changed in CAD, and design reviews",
      "Assembly documentation and build-book tools for connected CAD; review generated instructions before use",
    ],
  },
  {
    id: "competition",
    icon: "clipboard" as const,
    title: "Competition",
    href: "/features#competition",
    route: "/competition",
    promise: "Collect scouting, prepare match plans and coordinate the pit around your selected event.",
    modules: ["Event day", "Scout", "Teams", "Strategy", "Pit"],
    tools: [
      "Match and pit forms with local saving and queued uploads; prepare forms online before scouting offline",
      "Event day and My Day from the real match schedule",
      "Team lookup: every team at the event, with averages and a per-match trend for each stat your form collects",
      "Match planning and estimates using available scouting and public statistics",
      "Alliance selection desk, pick list, pairwise ranking",
      "Pit checklist, repair triage, battery rotation",
    ],
  },
  {
    id: "business",
    icon: "coins" as const,
    title: "Business",
    href: "/features#business",
    route: "/business",
    promise: "Track budgets, sponsor relationships, grants and outreach with students and mentors.",
    modules: ["Overview", "Money", "Sponsors", "Grants", "Outreach"],
    tools: [
      "Budgets, recorded spending, part requests and purchasing approvals",
      "Sponsor pipeline, packages and recognition",
      "Grant drafts and award essays from what the team actually did",
      "Outreach records, volunteer hours and content planning",
    ],
  },
] as const;

export const MARKETING_MENU = [
  {
    title: "Logistics",
    copy: "Hotels, travel legs, packing lists, on-duty mentors, and shop-tour invites.",
  },
  {
    title: "Exports",
    copy: "Authorized members can request data exports. Available formats and scope depend on the tool and their permissions.",
  },
  {
    title: "Desktop",
    copy: "A Windows app around the same Vantage, which also connects Fusion CAD on that computer.",
  },
] as const;

export const MARKETING_SEASON = [
  {
    title: "Preseason",
    copy: "Invite members, plan meetings and work through CAD, programming and mechanical learning materials.",
  },
  {
    title: "Build season",
    copy: "Calendar, tasks and chat run the shop. CAD vault, parts catalog, part requests and the budget keep design and money in step.",
  },
  {
    title: "Before you load in",
    copy: "Prepare scouting forms, select the event, review packing and travel, and bring the robot documentation your pit crew needs.",
  },
  {
    title: "At the event",
    copy: "Offline scouting, Event day and My Day, match predictions and strategy cards, alliance selection, pit triage — one event, one place.",
  },
] as const;
