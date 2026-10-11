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

/**
 * The four workspaces, each with what is inside it. Every tool line was checked against the code
 * or docs/FEATURE_MAP.md when it was written (October 2026); describe less rather than more.
 */
export const MARKETING_HUBS = [
  {
    id: "team",
    icon: "users" as const,
    title: "Team",
    href: "/features#team",
    route: "/team",
    promise: "Plan the week, keep the hours and the money straight, and talk in one place.",
    modules: ["Calendar", "Chat", "People", "Tasks", "Playbook"],
    tools: [
      { name: "Calendar and tasks", copy: "One team calendar with your matches on it, and tasks with owners and due dates." },
      { name: "Chat", copy: "Team channels and direct messages that stay with the team. Messages between an adult and a student include a second adult by default." },
      { name: "Hours and the shop kiosk", copy: "Students clock in at a kiosk by scanning a card. Typed-in hours are marked as typed, and only a mentor changes a closed session." },
      { name: "Tool training", copy: "Owners and mentors record who is cleared on each tool. Nobody signs themselves off." },
      { name: "People and roles", copy: "Owner, admin, team member and View only, so parents and guests can look without changing anything." },
      { name: "Playbook", copy: "The team wiki, season roadmap, decision notes, and a writer for grants and updates." },
    ],
  },
  {
    id: "build",
    icon: "wrench" as const,
    title: "Build",
    href: "/features#build",
    route: "/build",
    promise: "Review the code, keep the robot's record, and drive CAD from one place.",
    modules: ["Kickoff", "CAD", "Code", "Robot"],
    tools: [
      { name: "Pull request reviews", copy: "Connect your team's GitHub repository and each new or updated pull request gets a review. A finding has to quote a line the pull request adds, or it is dropped. Runs on your team's AI key." },
      { name: "Code map", copy: "Subsystems, commands, CAN IDs, vendor libraries and the WPILib version, read from your repository without AI and refreshed when the main branch changes." },
      { name: "Robot Blueprint", copy: "Every part of the robot, each linked to its CAD, its code and its checks." },
      { name: "CAD agent", copy: "Drive Onshape or Fusion 360 from Claude Code, with design-for-manufacturing checks before a part is built. Not certified engineering software: review what it makes." },
      { name: "Code Coach", copy: "Paste robot code and get the risky patterns flagged with why they fail and a safer habit." },
      { name: "Kickoff to inspection", copy: "Game brief, risk checks, battery health, weigh-in and inspection prep." },
    ],
  },
  {
    id: "competition",
    icon: "clipboard" as const,
    title: "Competition",
    href: "/features#competition",
    route: "/competition",
    promise: "Scout the pits and every match, then make the plan and the pick list together.",
    modules: ["Event day", "Scout", "Teams", "Match plan", "Our robot"],
    tools: [
      { name: "Pit scouting first", copy: "Scouting opens on the pits: visit the next team in one tap, search by number, and see who is left." },
      { name: "Quick scout", copy: "Your next robot from the schedule, one phase at a time in big tiles. It saves on the phone with no signal and says Sent only once your team has the report." },
      { name: "The scouting lead's view", copy: "Assign scouts, see robots nobody has covered, settle disagreements and check data quality before alliance selection." },
      { name: "Your own forms", copy: "Design your pit and match forms. Each report keeps the version of the form it was saved on." },
      { name: "Team lookup", copy: "Every team at the event, with your scouting beside public results from The Blue Alliance and ratings from Statbotics." },
      { name: "Event day", copy: "Your next match, queue time and bumper colour from the real schedule, on phones and a pit TV." },
      { name: "Match plans and picks", copy: "Match estimates from scouting and public statistics, a pick list you drag, and an alliance selection desk." },
    ],
  },
  {
    id: "business",
    icon: "coins" as const,
    title: "Business",
    href: "/features#business",
    route: "/business",
    promise: "Budgets, sponsors, grants and outreach, with clear rules for who changes money.",
    modules: ["Overview", "Money", "Sponsors", "Grants", "Outreach"],
    tools: [
      { name: "Finance managers", copy: "The owner chooses who manages money. Everyone else can read the budget and ask." },
      { name: "Two people for every claim", copy: "Reimbursements need a receipt, and nobody approves, denies or pays their own claim." },
      { name: "Budgets and orders", copy: "Season budget, recorded spending, part requests and purchase approvals." },
      { name: "Sponsors and grants", copy: "Sponsor pipeline and recognition, grant drafts and award essays from what the team actually did." },
      { name: "Outreach", copy: "Outreach records, volunteer hours and content planning." },
    ],
  },
] as const;

/** Learning lives inside Build (Code & CAD), but it is its own part of the season's story. */
export const MARKETING_LEARN = {
  id: "learn",
  icon: "cap" as const,
  title: "Learn",
  promise: "New members learn by doing, and Vantage checks the work.",
  tools: [
    { name: "Checked step by step", copy: "Onshape tracks from a first part to belt layouts, and Git and GitHub through your first pull request. Each step says when to use it, shows an example, and is checked before it counts." },
    { name: "Lead sign-offs", copy: "A step software can't see goes to a lead, who signs it off or sends it back with a note. Nobody signs off their own." },
    { name: "Lessons your team writes", copy: "Write a lesson in an editor that saves as you type, or upload a PDF, then add practice questions the app grades." },
    { name: "Team progress", copy: "Owners and mentors see every member's checked steps and the sign-offs waiting for them." },
  ],
} as const;

export const MARKETING_MENU = [
  {
    title: "Desktop app",
    copy: "Vantage for Windows and Mac. The same invite-only sign-in, and it stays signed in between launches.",
    href: "/desktop",
  },
  {
    title: "Spreadsheet copies",
    copy: "A live copy of your team's records in Google Sheets or Excel, readable even when Vantage is offline.",
    href: null,
  },
  {
    title: "Logistics and exports",
    copy: "Hotels, travel, packing lists and on-duty mentors, plus data exports for the people allowed to make them.",
    href: null,
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
