/**
 * Product hubs — a few workbenches per pillar, with related tools as inner tabs.
 * Legacy routes redirect here (see apps/web/next.config.ts).
 */

export type HubTabDef = {
  id: string;
  label: string;
  legacyHref?: string;
  /**
   * Inner tool under a workbench. Workbenches omit this and appear in the hub TabBar
   * and hamburger. Nested tabs appear in the second TabBar.
   */
  group?: string;
  /**
   * When false, the tab is nested (or a standalone More-tools leftover).
   * Defaults to true for workbench roots.
   */
  primary?: boolean;
  /**
   * Pin near the front of a workbench's inner tabs.
   */
  featured?: boolean;
  /**
   * When false, the tab stays in search, help, and access settings but is
   * omitted from the workbench ToolStrip unless it is the active deep link.
   * Defaults to true.
   */
  inStrip?: boolean;
};

export type ProductHubDef = {
  id: "competition" | "team" | "business" | "build" | "ai" | "media";
  href: string;
  label: string;
  title: string;
  description: string;
  defaultTab: string;
  tabs: HubTabDef[];
  /**
   * A hub whose page still exists and whose URLs still work, but which is no
   * longer one of the primary workspaces. Its tools are reached from another
   * workspace's tool strip (Media → Business › Outreach), from Settings (AI
   * controls), or from a persistent control (Ask AI). Hidden hubs stay in
   * PRODUCT_HUBS so the palette, help, and access settings still know them;
   * they are simply absent from NAV_HUBS, which the island and panel use.
   */
  hidden?: boolean;
};

function nest(group: string, tabs: Array<Omit<HubTabDef, "group">>): HubTabDef[] {
  return tabs.map((tab) => ({ ...tab, group, primary: false }));
}

export const PRODUCT_HUBS: ProductHubDef[] = [
  {
    id: "competition",
    href: "/competition",
    label: "Competition",
    title: "Competition",
    description: "Event day, scouting, strategy, and pit.",
    defaultTab: "command",
    tabs: [
      { id: "command", label: "Event day", legacyHref: "/command" },
      ...nest("command", [
        { id: "my-day", label: "My Day", legacyHref: "/my-day" },
        { id: "event-day-plan", label: "Day plan", legacyHref: "/event-day-plan" },
        { id: "drive-team-signals", label: "Drive-team board", legacyHref: "/drive-team-signals" },
        // THE one pre-match surface (absorbed Match Copilot — see legacy-redirects).
        { id: "briefing", label: "Pre-match briefing", legacyHref: "/briefing", featured: true },
        // Labelled "Schedule", not "Match schedule": seven palette entries already
        // start with "Matc" and the top-5 prefix ranking can only surface five.
        { id: "schedule", label: "Schedule", legacyHref: "/schedule" },
        { id: "rankings", label: "Rankings", legacyHref: "/rankings" },
        // The dated pre-event flow (inspection prep, consent, packing, travel) —
        // it belongs beside the day-of surfaces, not in a settings corner.
        { id: "event-readiness", label: "Event readiness", legacyHref: "/event-readiness" },
        { id: "video-analysis", label: "Match video", legacyHref: "/video-analysis", featured: true },
        { id: "packing", label: "Packing", legacyHref: "/packing", featured: true },
        { id: "tool-checkout", label: "Tool checkout", legacyHref: "/tool-checkout" },
        { id: "inspection-copilot", label: "Inspection", legacyHref: "/inspection-copilot" },
      ]),
      { id: "scouting", label: "Scouting", legacyHref: "/scouting" },
      ...nest("scouting", [
        { id: "forms", label: "Forms", legacyHref: "/scouting/forms" },
        { id: "scout-coverage-live", label: "Coverage", legacyHref: "/scout-coverage-live" },
        { id: "shift-balancer", label: "Shifts", legacyHref: "/shift-balancer" },
        { id: "scout-p2p-relay", label: "Pit link", legacyHref: "/scout-p2p-relay" },
        { id: "scout-training-mode", label: "Training", legacyHref: "/scout-training-mode" },
        { id: "scout-field-budget", label: "Field value", legacyHref: "/scout-field-budget" },
        { id: "data-quality-scorecard", label: "Data quality", legacyHref: "/data-quality-scorecard" },
        // Meta analysis of scouting — routes and Cmd+K stay; the strip does not.
        { id: "scout-accuracy", label: "Accuracy", legacyHref: "/scout-accuracy", inStrip: false },
        { id: "scout-crossval", label: "Cross-check", legacyHref: "/scout-crossval", inStrip: false },
        { id: "scout-disagreements", label: "Disagreements", legacyHref: "/scout-disagreements", inStrip: false },
        { id: "scout-data-impact", label: "Data impact", legacyHref: "/scout-data-impact", inStrip: false },
        { id: "scout-assisted-count", label: "Assisted count", legacyHref: "/scout-assisted-count", inStrip: false },
        { id: "scout-schema-negotiate", label: "Schema sync", legacyHref: "/scout-schema-negotiate", inStrip: false },
        { id: "scouting-heat-signals", label: "Heat signals", legacyHref: "/scouting-heat-signals", inStrip: false },
        { id: "scouting-schema-ab", label: "Schema A/B", legacyHref: "/scouting-schema-ab", inStrip: false },
      ]),
      { id: "strategy", label: "Strategy", legacyHref: "/strategy" },
      ...nest("strategy", [
        { id: "alliance-selection-desk", label: "Alliance desk", legacyHref: "/alliance-selection-desk", featured: true },
        { id: "picks", label: "Pick desk", legacyHref: "/strategy?tab=picks", featured: true },
        { id: "pick-clock", label: "Pick clock", legacyHref: "/pick-clock" },
        { id: "chemistry", label: "Chemistry", legacyHref: "/chemistry" },
        { id: "pairwise", label: "Pairwise", legacyHref: "/pairwise" },
        { id: "team-tags", label: "Drive-team tags", legacyHref: "/team-tags" },
        { id: "picklist-collab", label: "Pick list", legacyHref: "/picklist-collab" },
        { id: "picklist-justifier", label: "Justifier", legacyHref: "/picklist-justifier" },
        { id: "alliance-sim", label: "Alliance sim", legacyHref: "/alliance-sim" },
        { id: "alliance-partner-brief", label: "Partner brief", legacyHref: "/alliance-partner-brief" },
        { id: "counter-book", label: "Counter-book", legacyHref: "/counter-book" },
        { id: "defense-planner", label: "Defense", legacyHref: "/defense-planner" },
        { id: "opponent-watchlist", label: "Watchlist", legacyHref: "/opponent-watchlist" },
        { id: "match-strategy-cards", label: "Match cards", legacyHref: "/match-strategy-cards" },
        // "Match copilot" was consolidated into the Pre-match briefing (Event day tab);
        // /match-copilot now redirects to /briefing.
        { id: "match-sim", label: "Match sim", legacyHref: "/match-sim" },
        { id: "match-notes-timeline", label: "Match notes", legacyHref: "/match-notes-timeline" },
        { id: "match-delta-watcher", label: "Match delta", legacyHref: "/match-delta-watcher" },
        { id: "match-video-index", label: "Video index", legacyHref: "/match-video-index" },
        { id: "epa-trend-alerts", label: "Rating alerts", legacyHref: "/epa-trend-alerts" },
        { id: "overnight-intel", label: "Overnight brief", legacyHref: "/overnight-intel" },
        { id: "district-advancement", label: "Districts", legacyHref: "/district-advancement" },
        { id: "ranking-projection", label: "Rank projection", legacyHref: "/ranking-projection" },
        { id: "intel", label: "Research", legacyHref: "/intel" },
        { id: "dossier", label: "Team dossier", legacyHref: "/dossier" },
        { id: "video", label: "Video review", legacyHref: "/video" },
      ]),
      { id: "match-checklist", label: "Pit", legacyHref: "/match-checklist" },
      ...nest("match-checklist", [
        { id: "pit", label: "Pit command", legacyHref: "/pit" },
        { id: "pit-repair-triage", label: "Repair triage", legacyHref: "/pit-repair-triage" },
        { id: "battery-rotation", label: "Charge plan", legacyHref: "/battery-rotation" },
      ]),
    ],
  },
  {
    id: "team",
    href: "/team",
    label: "Team",
    title: "Team",
    description: "Calendar, chat, people, work, and the playbook.",
    defaultTab: "calendar",
    tabs: [
      { id: "calendar", label: "Calendar", legacyHref: "/team/calendar" },
      { id: "messages", label: "Chat", legacyHref: "/messages" },
      { id: "attendance", label: "People", legacyHref: "/attendance" },
      ...nest("attendance", [
        // What the public record says about this team (TBA + Statbotics), built
        // on first visit and refreshed weekly. Under People because the one thing
        // it cannot know — who is on the team — is answered right next to it.
        { id: "profile", label: "Team profile", legacyHref: "/team/profile", featured: true },
        { id: "hours", label: "Hours kiosk", legacyHref: "/hours", featured: true },
        // Subteams and Forms are people operations, so they live under People
        // rather than as their own drawer pillar — the drawer keeps one link
        // per pillar, and a tool nobody can click to might as well not exist.
        // "Subteam progress", not "Subteams": the Team calendar toolbar already
        // has a Subteams control, and two identical labels in one hub is the
        // confusion this product is trying to remove. The longer name also says
        // what the page is for.
        { id: "subteams", label: "Subteam progress", legacyHref: "/subteams", featured: true },
        { id: "team-forms", label: "Forms", legacyHref: "/forms", featured: true },
        // Announcements is nested rather than a fifth Team workbench: the set
        // of workbenches is pinned by a test on purpose, and "tell the team
        // something" belongs with the people it is told to.
        { id: "announcements", label: "Announcements", legacyHref: "/announcements", featured: true },
        // One presence record: RSVP → roll call → hours, so "who is coming tonight"
        // has a single answer instead of three half-answers.
        { id: "presence", label: "Presence", legacyHref: "/presence" },
        { id: "hours-self-view", label: "My hours", legacyHref: "/hours-self-view", featured: true },
        { id: "team-admin", label: "Invites", legacyHref: "/team/admin", featured: true },
        { id: "my-kit", label: "My kit", legacyHref: "/my-kit" },
        { id: "mentor-hours", label: "Mentor hours", legacyHref: "/mentor-hours" },
        // The programming subteam's setup track. Sits with the other
        // onboarding tools rather than under Build, because the person who
        // needs it is new to the TEAM, not to the robot.
        { id: "dev-setup", label: "Programming setup", legacyHref: "/dev-setup", featured: true },
        { id: "onboarding-buddy", label: "Onboarding buddy", legacyHref: "/onboarding-buddy" },
        { id: "getting-started", label: "Team setup", legacyHref: "/team/getting-started" },
        { id: "team-background", label: "Team background", legacyHref: "/team/background" },
        { id: "alumni-network", label: "Alumni", legacyHref: "/alumni-network" },
        { id: "skills-graph", label: "Skills", legacyHref: "/skills-graph" },
        // Learning sits next to Skills because its predictions feed the skills graph;
        // the mentor "who is struggling" view is the same people list, one level in.
        { id: "learning", label: "Learning", legacyHref: "/learning" },
        { id: "training", label: "Training matrix", legacyHref: "/training" },
        { id: "roles", label: "Season roles", legacyHref: "/roles", featured: true },
        { id: "leadership", label: "Leadership", legacyHref: "/leadership" },
        { id: "driver-tryouts", label: "Driver tryouts", legacyHref: "/driver-tryouts" },
        { id: "exit-interview", label: "Exit interviews", legacyHref: "/exit-interview" },
        // Families are part of the roster in practice: contacts, the digest email, and
        // the token-scoped read-only view a guardian opens without an account.
        { id: "parents", label: "Parents", legacyHref: "/parents" },
      ]),
      { id: "todos", label: "Work", legacyHref: "/todos" },
      ...nest("todos", [
        { id: "practice", label: "Practice", legacyHref: "/practice" },
        {
          id: "season-planning-workspace",
          label: "Season plan",
          legacyHref: "/season-planning-workspace",
          featured: true,
        },
        // Build-season kanban stays on /tasks and on Work's "Open build board"
        // button. It is not a second chip next to Work itself.
        { id: "task-board", label: "Task board", legacyHref: "/tasks", inStrip: false },
        { id: "goals-tracker", label: "Goals", legacyHref: "/goals-tracker" },
        { id: "goals", label: "Objectives", legacyHref: "/goals" },
        { id: "standup-digest", label: "Standup", legacyHref: "/standup-digest" },
        { id: "meeting-autopilot", label: "Meeting agenda", legacyHref: "/meeting-autopilot" },
        { id: "retro", label: "Retro", legacyHref: "/retro" },
        { id: "batteries", label: "Batteries", legacyHref: "/batteries" },
        { id: "fmea", label: "Failure log", legacyHref: "/fmea" },
        { id: "tool-checkout", label: "Tool checkout", legacyHref: "/tool-checkout" },
        { id: "equipment-maintenance", label: "Equipment", legacyHref: "/equipment-maintenance" },
        { id: "safety-training", label: "Safety", legacyHref: "/safety-training" },
        { id: "safety", label: "Safety log", legacyHref: "/safety" },
        { id: "checklist-library", label: "Checklists", legacyHref: "/checklist-library" },
        { id: "pit-map-planner", label: "Pit map", legacyHref: "/pit-map-planner" },
        { id: "field-reset-timer", label: "Field reset", legacyHref: "/field-reset-timer" },
      ]),
      { id: "knowledge", label: "Playbook", legacyHref: "/team/knowledge" },
      ...nest("knowledge", [
        // The rookie-survival roadmap. Community research rates "what do I even
        // prioritize" a blocker for rookie coaches, so it is pinned to the front of
        // the Playbook workbench rather than buried in the tail.
        { id: "roadmap", label: "Season roadmap", legacyHref: "/roadmap", featured: true },
        // From the former AI hub: written material belongs with the team's
        // other written material, not behind an "AI" pillar.
        { id: "writer", label: "Writer", legacyHref: "/writer" },
        { id: "decisions", label: "Decision notes", legacyHref: "/decisions" },
        { id: "season-report", label: "Season report", legacyHref: "/season-report" },
        // Vantage Drive. It sits under Playbook because that workbench is
        // already "the team's own written material", and a file space is the
        // same idea with the bytes attached. Featured, because it is the
        // reason a team can stop keeping half its season in someone's personal
        // Google Drive — a tool nobody can click to might as well not exist.
        { id: "files", label: "Files", legacyHref: "/files", featured: true },
        { id: "migrate", label: "Bring your season", legacyHref: "/migrate", featured: true },
        { id: "team-storage", label: "Storage node", legacyHref: "/team/storage" },
        { id: "team-relays", label: "AI relays", legacyHref: "/team/relays" },
        // Who may write the playbook. It belongs beside the pages it governs,
        // not in a settings corner — the owner grants the role from here.
        { id: "doc-roles", label: "Document roles", legacyHref: "/doc-roles" },
        // Capture-from-work review queue. It sits beside the Playbook because that is
        // where an approved draft lands — and nothing lands there without an Approve.
        { id: "knowledge-drafts", label: "Knowledge drafts", legacyHref: "/knowledge-drafts" },
        { id: "knowledge-gap", label: "Knowledge gaps", legacyHref: "/knowledge-gap" },
        { id: "notebook", label: "Engineering notebook", legacyHref: "/notebook" },
        { id: "offline-shell", label: "Offline", legacyHref: "/offline-shell" },
        { id: "degraded-mode", label: "Degraded mode", legacyHref: "/degraded-mode" },
        { id: "object-chat-bridge", label: "Object chat", legacyHref: "/object-chat-bridge" },
        { id: "bus-factor", label: "Bus factor", legacyHref: "/bus-factor" },
        { id: "team-health-dashboard", label: "Team health", legacyHref: "/team-health-dashboard" },
        { id: "cross-team-scrim", label: "Scrims", legacyHref: "/cross-team-scrim" },
        { id: "build-burndown", label: "Burndown", legacyHref: "/build-burndown" },
        { id: "risk-burndown", label: "Risk burndown", legacyHref: "/risk-burndown" },
        { id: "risks", label: "Risk register", legacyHref: "/risks" },
      ]),
    ],
  },
  {
    id: "business",
    href: "/business",
    label: "Business",
    title: "Business",
    description: "Money, sponsors, grants, and outreach.",
    defaultTab: "overview",
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "finance", label: "Money" },
      ...nest("finance", [
        { id: "budget", label: "Budget", featured: true },
        // The mentor-only season budget (0621 put season_budgets behind the
        // manage_budget capability in RLS). Distinct from the per-category
        // budget-vs-actual panel on the "Budget" tab above, which any member
        // can open.
        { id: "season-budget", label: "Season budget", legacyHref: "/budget" },
        // Where a student asks for a part without needing budget access.
        { id: "part-requests", label: "Part requests", legacyHref: "/part-requests" },
        // The COTS reference — what teams buy and the spec to pick between
        // them. Feeds both Inventory (add) and Part requests (ask).
        { id: "parts-catalog", label: "Parts catalog", legacyHref: "/parts-catalog", featured: true },
        { id: "orders", label: "Orders", legacyHref: "/orders" },
        { id: "costs", label: "Season costs", legacyHref: "/costs" },
        { id: "vendor-lead-times", label: "Lead times", legacyHref: "/vendor-lead-times" },
        { id: "reimbursements", label: "Reimbursements", legacyHref: "/reimbursements" },
        { id: "vendors", label: "Vendor directory", legacyHref: "/vendors" },
      ]),
      { id: "sponsors", label: "Sponsors" },
      ...nest("sponsors", [
        { id: "sponsorship", label: "Packages", legacyHref: "/sponsorship" },
        { id: "placements", label: "Partners" },
        { id: "sponsor-suite", label: "Sponsor suite", legacyHref: "/sponsor-suite" },
        { id: "sponsor-wall", label: "Sponsor wall", legacyHref: "/sponsor-wall" },
        { id: "sponsor-renewal-roi", label: "Renewal ROI", legacyHref: "/sponsor-renewal-roi" },
        { id: "sponsor-tier-calculator", label: "Tier calculator", legacyHref: "/sponsor-tier-calculator" },
        { id: "matching-gift-finder", label: "Matching gifts", legacyHref: "/matching-gift-finder" },
      ]),
      { id: "grants", label: "Grants", legacyHref: "/team/grants" },
      ...nest("grants", [
        // The "Grants" workbench root already links /team/grants; a second nested
        // entry for the same route showed the page twice in the inner TabBar.
        { id: "grant-calendar", label: "Grant calendar", legacyHref: "/team/grants/calendar", featured: true },
        { id: "grant-report", label: "Reports", legacyHref: "/grant-report" },
        { id: "grant-eligibility-matcher", label: "Eligibility", legacyHref: "/grant-eligibility-matcher" },
      ]),
      { id: "evidence", label: "Outreach" },
      ...nest("evidence", [
        { id: "fundraisers", label: "Fundraisers", legacyHref: "/fundraisers" },
        { id: "impact", label: "Impact", legacyHref: "/impact" },
        { id: "award-tracker", label: "Award tracker", legacyHref: "/award-tracker" },
        { id: "awards-workbench", label: "Awards", legacyHref: "/team/awards" },
        { id: "impact-essay", label: "Impact essay", legacyHref: "/impact-essay" },
        { id: "judge-sim", label: "Judge pitch", legacyHref: "/judge-sim" },
        { id: "mock-judging", label: "Mock judging", legacyHref: "/mock-judging" },
        { id: "media-kit", label: "Media kit", legacyHref: "/media?tab=kit" },
        { id: "outreach-calendar", label: "Outreach calendar", legacyHref: "/outreach-calendar" },
        // The former Media hub, now tools of Outreach. Same pages, one fewer
        // pillar to remember.
        { id: "content-calendar", label: "Content calendar", legacyHref: "/media?tab=calendar" },
        { id: "content-drafts", label: "Post drafts", legacyHref: "/media?tab=drafts" },
        { id: "content-reminders", label: "Posting reminders", legacyHref: "/media?tab=reminders" },
        { id: "media-library", label: "Photos & video", legacyHref: "/media-library" },
      ]),
    ],
  },
  {
    id: "build",
    href: "/build",
    label: "Build",
    title: "Build",
    description: "Kickoff, CAD, code, and the robot.",
    defaultTab: "kickoff",
    tabs: [
      { id: "kickoff", label: "Kickoff", legacyHref: "/kickoff" },
      { id: "cad", label: "CAD", legacyHref: "/cad" },
      ...nest("cad", [
        // The document vault (STL/STEP/DXF uploads, versions, subsystem links) — the
        // "where is the printable file" question, distinct from the live CAD model.
        { id: "cad-vault", label: "CAD vault", legacyHref: "/cad-vault", featured: true },
        // The build book generated from an Onshape assembly — steps, renders,
        // cut list, PDF. Featured because it is the surface that turns CAD into
        // something the person holding the wrench can use.
        { id: "assembly-manual", label: "Assembly manual", legacyHref: "/assembly-manual", featured: true },
        { id: "cad-change-radar", label: "Change radar", legacyHref: "/cad-change-radar" },
        { id: "sketch-to-brief", label: "Sketch to brief", legacyHref: "/sketch-to-brief" },
        // The learning track for new mechanical/design members — Onshape from
        // the first sketch to a mated assembly, ending in an auto-graded part.
        // Nested under CAD rather than added as a workbench: hubs.test.ts pins
        // Build's four workbenches, and a training surface is not one of them.
        { id: "cad-learn", label: "Learn CAD", legacyHref: "/cad-learn", featured: true },
      ]),
      { id: "code", label: "Code", legacyHref: "/code" },
      ...nest("code", [
        // Community research rates control-system get-unstuck the single most
        // recurring blocker, so it is pinned to the front of the Code workbench.
        { id: "troubleshoot", label: "Get unstuck", legacyHref: "/troubleshoot", featured: true },
        { id: "bugbot", label: "AI Bugbot", legacyHref: "/bugbot", featured: true },
        { id: "code-deploy-log", label: "Deploy log", legacyHref: "/code-deploy-log" },
        { id: "agent-config", label: "Team agent config", legacyHref: "/team/agent-config" },
        { id: "code-perf", label: "Code vs match", legacyHref: "/code-perf" },
      ]),
      { id: "fmea", label: "Robot", legacyHref: "/fmea" },
      ...nest("fmea", [
        { id: "robot", label: "Blueprint", legacyHref: "/robot", featured: true },
        { id: "subsystems", label: "Subsystem specs", legacyHref: "/subsystems" },
        { id: "bringup", label: "Bring-up", legacyHref: "/bringup" },
        { id: "reviews", label: "Design reviews", legacyHref: "/reviews" },
        { id: "gearbox", label: "Gearbox calculator", legacyHref: "/gearbox" },
        { id: "shooter-table", label: "Shooter table", legacyHref: "/shooter-table" },
        { id: "weight-budget", label: "Weight budget", legacyHref: "/weight-budget" },
        { id: "power-budget", label: "Power budget", legacyHref: "/power-budget" },
        { id: "prototype", label: "Prototypes", legacyHref: "/prototype-tracker" },
        { id: "batteries", label: "Batteries", legacyHref: "/batteries" },
        { id: "inspection-copilot", label: "Inspection", legacyHref: "/inspection-copilot" },
        { id: "robot-weigh-in", label: "Weigh-in", legacyHref: "/robot-weigh-in" },
        { id: "readiness-score", label: "Readiness", legacyHref: "/readiness-score" },
        { id: "wiring-diagnoser", label: "Wiring check", legacyHref: "/wiring-diagnoser" },
        { id: "wiring-map", label: "CAN-bus map", legacyHref: "/wiring" },
        { id: "rule-impact", label: "Rule impact", legacyHref: "/rule-impact" },
        { id: "tuning-autopilot", label: "Tuning advisor", legacyHref: "/tuning-autopilot" },
        { id: "tuning-log", label: "Tuning log", legacyHref: "/tuning" },
        { id: "failure-patterns", label: "Failure patterns", legacyHref: "/failure-patterns" },
        { id: "incident-heatmap", label: "Incidents", legacyHref: "/incident-heatmap" },
        { id: "auton-path-library", label: "Auton paths", legacyHref: "/auton-path-library" },
        { id: "reuse-advisor", label: "Reuse", legacyHref: "/reuse-advisor" },
        { id: "spare-forecast", label: "Spares forecast", legacyHref: "/spare-forecast" },
        // Where a BOM part actually gets made: "needs CAM" → machining → done.
        { id: "manufacturing", label: "Manufacturing", legacyHref: "/manufacturing" },
        // The printers themselves — queue, spools, and which subsystem a job is for.
        // Filed next to Consumables because filament is stock that runs out.
        { id: "print-farm", label: "Print farm", legacyHref: "/print-farm" },
        { id: "consumables", label: "Consumables", legacyHref: "/spares" },
        { id: "spare-robot-kit", label: "Spare kit", legacyHref: "/spare-robot-kit" },
        { id: "bin-shelf-locator", label: "Bin locator", legacyHref: "/bin-shelf-locator" },
        { id: "budget-reconciler", label: "Budget check", legacyHref: "/budget-reconciler" },
        { id: "bom-cost-rollup", label: "BOM cost", legacyHref: "/bom-cost-rollup" },
        { id: "battery-health-forecast", label: "Pack health", legacyHref: "/battery-health-forecast" },
        { id: "cross-domain-alerts", label: "Cross-domain", legacyHref: "/cross-domain-alerts" },
        { id: "decision-critic", label: "Decision critic", legacyHref: "/decision-critic" },
      ]),
    ],
  },
  {
    id: "ai",
    href: "/ai",
    label: "AI",
    title: "AI",
    // Not a team any more: "Ask AI" in the top bar opens the chat from
    // any page, and the controls (keys, budgets, governance, memory, usage)
    // live under Settings where configuration belongs. The hub page and every
    // /ai?tab= URL keep working.
    hidden: true,
    description: "Chat, writer, agent, and controls — usage and memory live as tabs inside Controls.",
    defaultTab: "chat",
    tabs: [
      { id: "chat", label: "Chat", legacyHref: "/chat" },
      { id: "writer", label: "Writer", legacyHref: "/writer" },
      { id: "agent", label: "Agent" },
      { id: "budgets", label: "Controls", legacyHref: "/team/budgets" },
      ...nest("budgets", [
        { id: "memory", label: "Memory", legacyHref: "/team/ai-memory" },
        { id: "governance", label: "Governance", legacyHref: "/team/ai-policy" },
        { id: "finance", label: "Finance" },
        { id: "ai-keys", label: "API keys", legacyHref: "/team/ai-keys", featured: true },
        { id: "ai-bridge", label: "Subscription bridge", legacyHref: "/team/ai-bridge" },
        { id: "ai-usage", label: "Your keys usage", legacyHref: "/team/ai-usage" },
        { id: "usage", label: "Usage", legacyHref: "/team/usage" },
      ]),
      { id: "decisions", label: "Notes", legacyHref: "/decisions" },
      ...nest("decisions", [
        { id: "decision-search", label: "Search", legacyHref: "/decision-search" },
        { id: "season-report", label: "Season report", legacyHref: "/season-report" },
        { id: "code", label: "Code assist", legacyHref: "/code" },
        { id: "bugbot", label: "Bugbot", legacyHref: "/bugbot" },
      ]),
    ],
  },
  {
    id: "media",
    href: "/media",
    label: "Media",
    title: "Media",
    // Folded into Business › Outreach: the content calendar, drafts,
    // reminders, kit and library are outreach work, and a sixth top-level
    // pillar for them was one more place to look. The page and its URLs stay.
    hidden: true,
    description: "Calendar, drafts, reminders, kit, and impact.",
    defaultTab: "calendar",
    tabs: [
      { id: "calendar", label: "Calendar" },
      { id: "drafts", label: "Drafts" },
      { id: "reminders", label: "Reminders" },
      { id: "kit", label: "Kit", legacyHref: "/media-kit" },
      ...nest("kit", [
        { id: "media-library", label: "Media library", legacyHref: "/media-library", featured: true },
      ]),
      { id: "impact", label: "Impact", legacyHref: "/impact" },
    ],
  },
];

/**
 * The primary workspaces: what the island, the All panel hub rows and the
 * marketing page list. Four plus Home is the whole top level; All hangs the
 * other workbenches under each hub row. Nested tools stay inside a workbench.
 */
export const NAV_HUBS: ProductHubDef[] = PRODUCT_HUBS.filter((hub) => !hub.hidden);

export function hubById(id: ProductHubDef["id"]): ProductHubDef {
  const hub = PRODUCT_HUBS.find((entry) => entry.id === id);
  if (!hub) throw new Error(`Unknown hub: ${id}`);
  return hub;
}

export function navHubByLabel(label: string): ProductHubDef | undefined {
  return PRODUCT_HUBS.find((entry) => entry.label === label);
}

export function isHubTab(hub: ProductHubDef, value: string | null | undefined): value is string {
  return Boolean(value && hub.tabs.some((tab) => tab.id === value));
}

/** Workbenches shown in the hub TabBar and hamburger (no `group`). */
export function hubPrimaryTabs(hub: ProductHubDef): HubTabDef[] {
  return hub.tabs.filter((tab) => !tab.group);
}

export function hubWorkbenchId(hub: ProductHubDef, tabId: string): string {
  const tab = hub.tabs.find((entry) => entry.id === tabId);
  if (!tab) return hub.defaultTab;
  return tab.group ?? tab.id;
}

/** Workbench root plus its inner tools, for the second TabBar. */
export function hubNestedTabs(hub: ProductHubDef, workbenchId: string): HubTabDef[] {
  const root = hub.tabs.find((tab) => tab.id === workbenchId && !tab.group);
  const nested = hub.tabs.filter((tab) => tab.group === workbenchId);
  return root ? [root, ...nested] : nested;
}

/**
 * Inner tools shown in the workbench ToolStrip. Jobs with `inStrip: false`
 * stay in `hubNestedTabs` (search, help, access) and only appear here when
 * they are the active deep link, so a search hit is not a missing chip.
 */
export function hubStripTabs(
  hub: ProductHubDef,
  workbenchId: string,
  activeId?: string,
): HubTabDef[] {
  return hubNestedTabs(hub, workbenchId).filter(
    (tab) => tab.inStrip !== false || tab.id === activeId,
  );
}

/** Nested tools (and leftover standalone pages) that have a route. */
export function hubMoreTabs(hub: ProductHubDef): HubTabDef[] {
  return hub.tabs.filter((tab) => Boolean(tab.group) && Boolean(tab.legacyHref));
}

/** Featured pins inside a workbench. */
export function hubFeaturedMoreTabs(hub: ProductHubDef): HubTabDef[] {
  return hubMoreTabs(hub).filter((tab) => tab.featured === true);
}

export function hubHref(hubPath: string, tab: string, orgId?: string | null): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (orgId) params.set("orgId", orgId);
  return `${hubPath}?${params.toString()}`;
}

/**
 * Deep link to the workbench a tab lives under, rather than to the tab itself.
 *
 * Leaf tools build their "back to hub" link from their own tab id, so the link
 * lands the user right back on the leaf they were trying to leave instead of the
 * section they came from. Pass the leaf id here to get its parent workbench root:
 * a workbench root resolves to itself, and an unknown id falls back to the hub's
 * defaultTab (via hubWorkbenchId).
 */
export function hubWorkbenchHref(
  hubId: ProductHubDef["id"],
  tabId: string,
  orgId?: string | null,
): string {
  const hub = hubById(hubId);
  return hubHref(hub.href, hubWorkbenchId(hub, tabId), orgId);
}

export function hubLegacyHref(tab: HubTabDef, orgId?: string | null): string {
  const base = tab.legacyHref ?? "#";
  if (!orgId) return base;
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}orgId=${encodeURIComponent(orgId)}`;
}

