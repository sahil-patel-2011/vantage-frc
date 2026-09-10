import type { OnboardingTrackTemplate } from "./types";

function checks(
  items: Array<[string, string, string, string?]>,
): OnboardingTrackTemplate["checks"] {
  return items.map(([key, label, detail, href]) => ({
    key,
    label,
    detail,
    href,
  }));
}

/** Static checklist templates. Progress is stored per member; nothing is seeded in SQL. */
export const ONBOARDING_TRACKS: OnboardingTrackTemplate[] = [
  {
    key: "welcome",
    title: "Welcome to Vantage",
    summary: "Orient yourself before diving into a subteam path.",
    source: "welcome",
    checks: checks([
      ["open_workspace", "Choose your team", "Confirm the right team is active.", "/workspace"],
      ["join_calendar", "Join a subteam calendar", "Pick the crew you practice with so events show up.", "/team/calendar"],
      ["read_knowledge", "Skim Team Knowledge", "Robot conventions and season notes the AI already reads.", "/team/knowledge"],
      ["try_chat", "Ask the team assistant one real question", "Strategy, packing, or what you should do first.", "/chat"],
    ]),
  },
  {
    key: "mechanical",
    title: "Mechanical path",
    summary: "Fabrication, mechanisms, and bring-up with the build crew.",
    source: "subteam",
    checks: checks([
      ["read_blueprint", "Review the robot blueprint", "Understand current mechanism priorities.", "/robot"],
      ["check_inventory", "Check inventory / BOM", "Know what parts you already have before ordering.", "/inventory"],
      ["log_fmea", "Log a failure or risk", "Capture what breaks so the next iteration is safer.", "/fmea"],
      ["open_cad", "Open AI CAD", "Pull the latest design context when Onshape/Fusion is connected.", "/cad"],
    ]),
  },
  {
    key: "electrical",
    title: "Electrical path",
    summary: "Wiring, PDH layout, and first-power safety.",
    source: "subteam",
    checks: checks([
      ["control_map", "Open the control map", "See CAN devices and driver-station layout.", "/control-map"],
      ["battery_habit", "Learn battery tracking", "Charged / in-use / cool-down is a competition safety habit.", "/batteries"],
      ["safety_pass", "Read the safety expectations", "Lockout and first-power rules before you energize.", "/team/knowledge"],
      ["inspection_prep", "Skim inspection checklist", "Know what electrical inspectors will ask for.", "/inspection"],
    ]),
  },
  {
    key: "programming",
    title: "Programming path",
    summary: "Robot code, versions, and software bring-up.",
    source: "subteam",
    checks: checks([
      ["open_code", "Open Code", "Find the team repo and current season branch context.", "/code"],
      ["software_versions", "Check software versions", "WPIlib / vendordep alignment before you flash.", "/software-versions"],
      ["github_link", "Confirm GitHub is connected", "AI code context needs an org GitHub link.", "/team"],
      ["control_map_sw", "Cross-check the control map", "Buttons and subsystems should match what drivers expect.", "/control-map"],
    ]),
  },
  {
    key: "cad",
    title: "CAD path",
    summary: "Design reviews, part studios, and manufacture handoff.",
    source: "subteam",
    checks: checks([
      ["cad_setup", "Connect CAD", "Onshape or Fusion pairing so the agent can see live models.", "/cad"],
      ["robot_blueprint", "Align on the robot blueprint", "Design priorities before you spend CAD hours.", "/robot"],
      ["decisions", "Read recent design decisions", "Avoid re-litigating closed choices.", "/decisions"],
      ["vendors", "Know vendor lead times", "Order long-lead parts early.", "/vendors"],
    ]),
  },
  {
    key: "drive_team",
    title: "Drive team path",
    summary: "Driver practice, match checklists, and field habits.",
    source: "subteam",
    checks: checks([
      ["practice_planner", "Open practice planner", "Book driver practice blocks on the calendar.", "/practice"],
      ["match_checklist", "Walk the match checklist", "Pre-match habits before eliminations.", "/match-checklist"],
      ["my_day", "Use My Day at events", "Next match, bumper color, partners, opponents.", "/my-day"],
      ["command", "Open Event Day Command", "Field communication hub during matches.", "/command"],
    ]),
  },
  {
    key: "scouting",
    title: "Scouting path",
    summary: "Stand scouting, coverage, and strategy handoff.",
    source: "subteam",
    checks: checks([
      ["scout_hub", "Open the Scouting Hub", "Forms, assignments, and quality checks.", "/scouting"],
      ["lineup", "Check lineup and coverage", "Who is scouting which matches.", "/scouting/lineup"],
      ["strategy", "Read Strategy and AI", "How stand data feeds alliance picks.", "/strategy"],
      ["video", "Try video review", "Re-scout a match clip when stand notes disagree.", "/video"],
    ]),
  },
  {
    key: "business",
    title: "Business path",
    summary: "Sponsors, grants, awards writing, and impact.",
    source: "subteam",
    checks: checks([
      ["business_hub", "Open the Business Hub", "Season fundraising and outreach home.", "/business"],
      ["sponsors", "Review sponsors", "Active partners and follow-ups.", "/team/sponsors"],
      ["grants", "Check grants", "Deadlines and narrative drafts.", "/team/grants"],
      ["impact", "Log community impact", "Hours and people reached for awards evidence.", "/impact"],
    ]),
  },
  {
    key: "safety",
    title: "Safety path",
    summary: "Shop rules, incidents, and competition safety culture.",
    source: "subteam",
    checks: checks([
      ["knowledge_safety", "Read shop safety notes", "PPE, tooling, and mentor coverage expectations.", "/team/knowledge"],
      ["incidents", "Know how to log an incident", "Report early — no blame culture.", "/incidents"],
      ["batteries_safety", "Battery handling rules", "Never leave a swelling pack unattended.", "/batteries"],
      ["inspection_safety", "Inspection readiness", "Bumpers, labels, and mechanical safety.", "/inspection"],
    ]),
  },
  {
    key: "role_student",
    title: "Student role",
    summary: "How students move from first login to owning work.",
    source: "role",
    checks: checks([
      ["todos", "Claim a todo", "Pick something small and finish it this week.", "/team?tab=todos"],
      ["messages", "Introduce yourself in Messages", "Say your subteam and what you want to learn.", "/messages"],
      ["attendance", "Understand attendance", "Build hours and practice roll expectations.", "/attendance"],
      ["goals", "See season goals", "Know what done looks like for the team.", "/goals"],
    ]),
  },
  {
    key: "role_mentor",
    title: "Mentor role",
    summary: "Guide students without becoming the bottleneck.",
    source: "role",
    checks: checks([
      ["getting_started", "Finish team setup signals", "Invites, knowledge, budgets — org-wide checklist.", "/team/getting-started"],
      ["invite", "Invite missing mentors/students", "Exact-email invites keep the roster closed.", "/team"],
      ["roles", "Review role assignments", "Who owns mechanical, software, scouting, business.", "/roles"],
      ["risks", "Skim the risk register", "Surface blockers before they slip a week.", "/risks"],
    ]),
  },
  {
    key: "role_coach",
    title: "Coach role",
    summary: "Season rhythm, adults in the room, and competition readiness.",
    source: "role",
    checks: checks([
      ["calendar", "Review the team calendar", "Practice density and adult coverage.", "/team/calendar"],
      ["logistics", "Open event logistics", "Travel, lodging, and day-of contacts.", "/logistics"],
      ["briefing", "Read event briefing", "Venue, pits, and alliance notes before you travel.", "/briefing"],
      ["budgets", "Confirm AI budgets", "Hard caps before students run expensive tools.", "/team/budgets"],
    ]),
  },
  {
    key: "role_parent",
    title: "Parent / guardian role",
    summary: "Support travel, volunteering, and team communications.",
    source: "role",
    checks: checks([
      ["announcements", "Read announcements", "Trip forms and schedule changes land here.", "/notifications"],
      ["logistics_parent", "Check logistics", "Hotels and leave times for competition weekends.", "/logistics"],
      ["visit", "Visit invites", "Guest pit / stands access when the team uses them.", "/visit-invites"],
      ["hours_parent", "See build hours", "Understand how student time is tracked.", "/hours"],
    ]),
  },
  {
    key: "role_other",
    title: "Team contributor",
    summary: "A light path when your role is custom or still settling.",
    source: "role",
    checks: checks([
      ["start_welcome", "Complete Welcome checks", "Orient first, then pick a subteam path.", "/start"],
      ["calendar_other", "Join the right calendar", "Ask a mentor which subteam fits.", "/team/calendar"],
      ["knowledge_other", "Read Team Knowledge", "Season context in one place.", "/team/knowledge"],
    ]),
  },
  {
    key: "focus_competition",
    title: "Competition focus",
    summary: "You said competition is your primary focus — prioritize field ops.",
    source: "focus",
    checks: checks([
      ["command_focus", "Open Event Day Command", "Match flow and pit coordination.", "/command"],
      ["scout_focus", "Visit Scouting Hub", "Stand coverage feeds picks.", "/scouting"],
      ["my_day_focus", "Pin My Day", "Glanceable next-match card on your phone.", "/my-day"],
      ["strategy_focus", "Open Strategy and AI", "Alliance chemistry before eliminations.", "/strategy"],
    ]),
  },
  {
    key: "focus_build",
    title: "Build focus",
    summary: "Design/build season — CAD, code, and subsystem delivery.",
    source: "focus",
    checks: checks([
      ["cad_focus", "Connect CAD tooling", "Onshape/Fusion for design reviews.", "/cad"],
      ["code_focus", "Open Code", "Repo and season branch.", "/code"],
      ["subsystems", "Review subsystems", "Ownership and status of each mechanism.", "/subsystems"],
      ["kickoff", "Kickoff summary", "Scoring priorities that drive design tradeoffs.", "/kickoff"],
    ]),
  },
  {
    key: "focus_business",
    title: "Business focus",
    summary: "Sponsors, grants, and awards narrative.",
    source: "focus",
    checks: checks([
      ["business_focus", "Business Hub", "Fundraising home base.", "/business"],
      ["sponsors_focus", "Sponsors", "Active partners and asks.", "/team/sponsors"],
      ["writer", "Award Writer", "Draft Chairman and EI language from real evidence.", "/writer"],
      ["exports", "Exports", "Pull packets for judges and partners.", "/exports"],
    ]),
  },
  {
    key: "focus_leadership",
    title: "Leadership focus",
    summary: "People systems — goals, risks, and continuity.",
    source: "focus",
    checks: checks([
      ["goals_focus", "Season goals", "Publish what success looks like.", "/goals"],
      ["risks_focus", "Risk register", "Name blockers early.", "/risks"],
      ["roles_focus", "Roles", "Clear owners for each pillar.", "/roles"],
      ["alumni", "Alumni network", "Keep grads connected for mentorship.", "/team/alumni"],
    ]),
  },
];

export const TRACK_BY_KEY: Record<string, OnboardingTrackTemplate> = Object.fromEntries(
  ONBOARDING_TRACKS.map((track) => [track.key, track]),
);
