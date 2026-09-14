/**
 * Public marketing copy. Everything named here ships in apps/web today.
 *
 * The story is "one place for everything an FRC team does, and it teaches new
 * members on the way in". AI is a helper inside that — strategy, match
 * prediction, design help — not the product. The four entries in
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
    copy: "Paced Onshape lessons and CAD Video Tutor on cast iron. Vantage reads mass and spin from the real document — students never type those numbers.",
  },
  {
    title: "Watch match video",
    copy: "Paste a match or pit video, confirm the timeline, and keep it as evidence. Scouted numbers do not change.",
  },
  {
    title: "Run practice",
    copy: "Hours, packing, pit checklists, chat, and practice roll calls — emails already on the roster stay when you add people.",
  },
] as const;

export const MARKETING_HUBS = [
  {
    id: "team",
    icon: "users" as const,
    title: "Team",
    href: "/features#team",
    route: "/team",
    promise: "The week: calendar and tasks, chat, files, people, and the team's own playbook.",
    modules: ["Calendar", "Chat", "People", "Work", "Playbook"],
    tools: [
      "One calendar for meetings, tasks, matches and deadlines — with an assistant that finds a time from when your team actually shows up",
      "Files: a team drive and a private space for every member, shareable by link or email",
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
    promise: "From a new member's first sketch to a printable build book for the finished robot.",
    modules: ["Kickoff", "CAD", "Code", "Robot"],
    tools: [
      "Learn CAD: Onshape from the first sketch, CAD Video Tutor on cast iron, Explore Onshape progress, then a graded part",
      "Team 6925 lab: paced Limelight, WPILib, PathPlanner and GitHub weeks with official docs only",
      "Programming setup: Git, VS Code, WPILib and PathPlanner with real download links, plus the GitHub Student Pack walk-through",
      "CAD vault with Onshape links, change radar, and design reviews",
      "The assembly manual: your Onshape assembly turned into a step-by-step build book with parts, cuts and drill sizes",
    ],
  },
  {
    id: "competition",
    icon: "clipboard" as const,
    title: "Competition",
    href: "/features#competition",
    route: "/competition",
    promise: "Scout offline, see the next match, pick the alliance from evidence.",
    modules: ["Event day", "Scouting", "Strategy", "Pit"],
    tools: [
      "Match and pit forms that work with no Wi-Fi and sync later",
      "Event day and My Day from the real match schedule",
      "Match prediction from your scouting plus public stats, with a measured error band — not a promised ±3",
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
    promise: "Money, sponsors, grants, awards and outreach — the mentor side, kept straight.",
    modules: ["Overview", "Money", "Sponsors", "Grants", "Outreach"],
    tools: [
      "Season budget, part requests from students, orders and costs — mentors approve, students ask",
      "Sponsor pipeline, packages and recognition",
      "Grant drafts and award essays from what the team actually did",
      "Outreach log with hours by person, content calendar, and the media kit",
    ],
  },
] as const;

/** The two helpers that used to be their own pillars. */
export const MARKETING_HELPERS = [
  {
    title: "Claude Code",
    copy: "Ask the team questions from your own scouting, calendar, and files. Pair Claude Code so students do not paste an API key. It says when it does not know.",
  },
  {
    title: "Honest scores",
    copy: "Next-match totals show a typical error from the last measured set. Missing ratings skip the match rather than filling a number.",
  },
] as const;

export const MARKETING_PROBLEMS = [
  {
    icon: "cap" as const,
    title: "Fifty accounts for a new student",
    copy: "Discord, Drive, Onshape, GitHub, a scouting app, three spreadsheets and a group chat — before they have learned a single tool. Half of onboarding is remembering passwords.",
  },
  {
    icon: "chat" as const,
    title: "The decision is four hundred messages up",
    copy: "Why the intake is geared like that was settled in a chat in week two. In week five nobody can find it, so the team argues it again.",
  },
  {
    icon: "table" as const,
    title: "A senior who knows walks out in June",
    copy: "The person who understood the wiring, the budget and the pick list graduates, and the reasoning graduates with them.",
  },
] as const;

export const MARKETING_LEARN = [
  {
    step: "1",
    title: "Learn",
    copy: "A new member gets paced weeks, not a wiki dump: laptop setup, CAD Video Tutor, Onshape from the first sketch to a graded part, Limelight and Git — with Claude Code when they get stuck.",
  },
  {
    step: "2",
    title: "Build",
    copy: "CAD lives where the team can find it, the parts catalog knows what to order, and when the robot is designed the assembly manual turns the CAD into a build book anyone can follow.",
  },
  {
    step: "3",
    title: "Run the team",
    copy: "Calendar and tasks, files, chat, hours, outreach, money — one login, one place, nothing to re-explain to the next student.",
  },
  {
    step: "4",
    title: "Compete",
    copy: "Scout with no Wi-Fi, see the next match with a measured error band, pick the alliance from evidence you collected, run the pit.",
  },
] as const;

export const MARKETING_TRUST = [
  {
    icon: "lock" as const,
    title: "Invite-only, your data is yours",
    copy: "Owners invite exact emails. Each team sees only its own rows. Personal files are private even from mentors. Export everything, any time.",
  },
  {
    icon: "wifi" as const,
    title: "Works in the pit",
    copy: "Scouting forms, checklists and the calendar keep working with no signal, then sync when you are back on Wi-Fi.",
  },
  {
    icon: "shield" as const,
    title: "AI that helps, and shows its work",
    copy: "Claude Code answers from your team's data, cites what it used, and says when there is not enough to answer. CAD and code changes always wait for a person. Match scores show a measured band, not a promise.",
  },
] as const;

export const MARKETING_MENU = [
  {
    title: "Logistics",
    copy: "Hotels, travel legs, packing lists, on-duty mentors, and shop-tour invites.",
  },
  {
    title: "Exports",
    copy: "Take the whole team's data out as CSV and ZIP whenever you want. Keys are never included.",
  },
  {
    title: "Desktop",
    copy: "A Windows app around the same Vantage, with the local relay for Fusion CAD.",
  },
] as const;

export const MARKETING_SEASON = [
  {
    title: "Preseason",
    copy: "New members work through CAD Video Tutor, Learn CAD, and the Team 6925 lab. Calendar, files, and practice emails are already there when they arrive.",
  },
  {
    title: "Build season",
    copy: "Calendar, tasks and chat run the shop. CAD vault, parts catalog, part requests and the budget keep design and money in step.",
  },
  {
    title: "Before you load in",
    copy: "Publish scout forms, set the event, pack, plan travel, and print the build book so the pit crew can rebuild anything.",
  },
  {
    title: "At the event",
    copy: "Offline scouting, Event day and My Day, match predictions and strategy cards, alliance selection, pit triage — one event, one place.",
  },
] as const;
