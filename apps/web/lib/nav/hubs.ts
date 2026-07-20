/**
 * Product hubs — consolidate related surfaces behind Soft-UI TabBar shells.
 * Legacy routes redirect here (see apps/web/next.config.ts).
 */

export type HubTabDef = {
  id: string;
  label: string;
  legacyHref?: string;
  /**
   * When false, the tab is listed under Soft-UI “More tools” (link to legacyHref)
   * instead of the primary TabBar. Defaults to true.
   */
  primary?: boolean;
  /**
   * When true (and primary === false), pin above the More tools list for discoverability.
   */
  featured?: boolean;
};

export type ProductHubDef = {
  id: "competition" | "team" | "business" | "build" | "ai";
  href: string;
  label: string;
  title: string;
  description: string;
  defaultTab: string;
  tabs: HubTabDef[];
};

export const PRODUCT_HUBS: ProductHubDef[] = [
  {
    id: "competition",
    href: "/competition",
    label: "Competition",
    title: "Competition",
    description:
      "Event day command, personal schedule, strategy, scouting, form builder, match checklist, picks, chemistry — plus Alliance Selection Desk in More tools.",
    defaultTab: "command",
    tabs: [
      { id: "command", label: "Command", legacyHref: "/command" },
      { id: "my-day", label: "My Day", legacyHref: "/my-day" },
      { id: "strategy", label: "Strategy", legacyHref: "/strategy" },
      { id: "scouting", label: "Scouting", legacyHref: "/scouting" },
      { id: "forms", label: "Form builder", legacyHref: "/scouting/forms" },
      { id: "match-checklist", label: "Match checklist", legacyHref: "/match-checklist" },
      { id: "pick-clock", label: "Pick clock", legacyHref: "/pick-clock" },
      { id: "chemistry", label: "Chemistry", legacyHref: "/chemistry" },
      { id: "alliance-partner-brief", label: "Alliance-Partner Brief", legacyHref: "/alliance-partner-brief", primary: false },
      {
        id: "alliance-selection-desk",
        label: "Alliance Selection Desk 2.0",
        legacyHref: "/alliance-selection-desk",
        primary: false,
        featured: true,
      },
      { id: "alliance-sim", label: "Alliance Sim", legacyHref: "/alliance-sim", primary: false },
      { id: "battery-rotation", label: "Battery Rotation & Charge Planner", legacyHref: "/battery-rotation", primary: false },
      { id: "counter-book", label: "Opponent Counter-book", legacyHref: "/counter-book", primary: false },
      { id: "data-quality-scorecard", label: "Data Quality Scorecard", legacyHref: "/data-quality-scorecard", primary: false },
      { id: "defense-planner", label: "Defense Planner", legacyHref: "/defense-planner", primary: false },
      { id: "drive-team-signals", label: "Drive-Team Signal Board", legacyHref: "/drive-team-signals", primary: false },
      { id: "epa-trend-alerts", label: "EPA Trend Alerts", legacyHref: "/epa-trend-alerts", primary: false },
      { id: "event-day-plan", label: "Event-Day Stress Planner", legacyHref: "/event-day-plan", primary: false },
      { id: "match-copilot", label: "Match Copilot", legacyHref: "/match-copilot", primary: false },
      { id: "match-delta-watcher", label: "Match-Delta Watcher", legacyHref: "/match-delta-watcher", primary: false },
      { id: "match-notes-timeline", label: "Match Note Timeline", legacyHref: "/match-notes-timeline", primary: false },
      { id: "match-sim", label: "Match Simulator", legacyHref: "/match-sim", primary: false },
      { id: "match-strategy-cards", label: "Match Strategy Cards", legacyHref: "/match-strategy-cards", primary: false },
      { id: "match-video-index", label: "Match Video Index", legacyHref: "/match-video-index", primary: false },
      { id: "opponent-watchlist", label: "Opponent Watchlist", legacyHref: "/opponent-watchlist", primary: false },
      { id: "overnight-intel", label: "Overnight Event-Intel Brief", legacyHref: "/overnight-intel", primary: false },
      { id: "picklist-collab", label: "Collaborative Pick List", legacyHref: "/picklist-collab", primary: false },
      { id: "picklist-justifier", label: "Pick-list Auto-Justifier", legacyHref: "/picklist-justifier", primary: false },
      { id: "pit-repair-triage", label: "Pit Repair Triage", legacyHref: "/pit-repair-triage", primary: false },
      { id: "scout-accuracy", label: "Scout Accuracy", legacyHref: "/scout-accuracy", primary: false },
      { id: "scout-assisted-count", label: "Scout-Assisted Count", legacyHref: "/scout-assisted-count", primary: false },
      { id: "scout-coverage-live", label: "Scout Coverage Live", legacyHref: "/scout-coverage-live", primary: false },
      { id: "scout-crossval", label: "Scout Cross-Validation", legacyHref: "/scout-crossval", primary: false },
      { id: "scout-data-impact", label: "Scout Data Impact", legacyHref: "/scout-data-impact", primary: false },
      { id: "scout-disagreements", label: "Scout Disagreements", legacyHref: "/scout-disagreements", primary: false },
      { id: "scout-field-budget", label: "Scouting Field-Count Budget", legacyHref: "/scout-field-budget", primary: false },
      { id: "scout-p2p-relay", label: "Scout P2P Relay", legacyHref: "/scout-p2p-relay", primary: false },
      { id: "scout-schema-negotiate", label: "Scout Schema Negotiate", legacyHref: "/scout-schema-negotiate", primary: false },
      { id: "scout-training-mode", label: "Scout Training Mode", legacyHref: "/scout-training-mode", primary: false },
      { id: "scouting-heat-signals", label: "Scouting Heat Signals", legacyHref: "/scouting-heat-signals", primary: false },
      { id: "scouting-schema-ab", label: "Scouting Schema A/B", legacyHref: "/scouting-schema-ab", primary: false },
      { id: "shift-balancer", label: "Scout Shift Load Balancer", legacyHref: "/shift-balancer", primary: false },
    ],
  },
  {
    id: "team",
    href: "/team",
    label: "Team",
    title: "Team",
    description:
      "Calendar & subteams, todos, practice, attendance, knowledge, messages, batteries, and FMEA — Season Planning in More tools.",
    defaultTab: "calendar",
    tabs: [
      { id: "calendar", label: "Calendar", legacyHref: "/team/calendar" },
      { id: "todos", label: "Todos", legacyHref: "/todos" },
      { id: "messages", label: "Messages", legacyHref: "/messages" },
      { id: "practice", label: "Practice", legacyHref: "/practice" },
      { id: "knowledge", label: "Knowledge", legacyHref: "/team/knowledge" },
      { id: "attendance", label: "Attendance", legacyHref: "/attendance" },
      { id: "batteries", label: "Batteries", legacyHref: "/batteries" },
      { id: "fmea", label: "FMEA", legacyHref: "/fmea" },
      { id: "task-board", label: "Build-Season Task Board", legacyHref: "/tasks", primary: false },
      { id: "alumni-network", label: "Alumni Network", legacyHref: "/alumni-network", primary: false },
      { id: "build-burndown", label: "Build-Season Burndown", legacyHref: "/build-burndown", primary: false },
      { id: "bus-factor", label: "Bus-Factor & Burnout Watch", legacyHref: "/bus-factor", primary: false },
      { id: "checklist-library", label: "Checklist Library", legacyHref: "/checklist-library", primary: false },
      { id: "cross-team-scrim", label: "Cross-Team Scrim Scheduling", legacyHref: "/cross-team-scrim", primary: false },
      { id: "degraded-mode", label: "Data-Source Degraded Mode", legacyHref: "/degraded-mode", primary: false },
      { id: "driver-tryouts", label: "Driver Tryouts", legacyHref: "/driver-tryouts", primary: false },
      { id: "equipment-maintenance", label: "Equipment Maintenance", legacyHref: "/equipment-maintenance", primary: false },
      { id: "exit-interview", label: "Graduation Exit Interviews", legacyHref: "/exit-interview", primary: false },
      { id: "field-reset-timer", label: "Field Reset Timer", legacyHref: "/field-reset-timer", primary: false },
      { id: "goals-tracker", label: "Season Goals Tracker", legacyHref: "/goals-tracker", primary: false },
      {
        id: "season-planning-workspace",
        label: "Season Planning Workspace",
        legacyHref: "/season-planning-workspace",
        primary: false,
        featured: true,
      },
      { id: "hours-self-view", label: "My Hours (Self-View & Kiosk)", legacyHref: "/hours-self-view", primary: false },
      { id: "knowledge-gap", label: "Knowledge-gap detective", legacyHref: "/knowledge-gap", primary: false },
      { id: "meeting-autopilot", label: "Meeting-Agenda Autopilot", legacyHref: "/meeting-autopilot", primary: false },
      { id: "mentor-hours", label: "Mentor Hours & Engagement", legacyHref: "/mentor-hours", primary: false },
      { id: "object-chat-bridge", label: "Object Chat Bridge", legacyHref: "/object-chat-bridge", primary: false },
      { id: "offline-shell", label: "Offline Shell", legacyHref: "/offline-shell", primary: false },
      { id: "onboarding-buddy", label: "Onboarding Buddy", legacyHref: "/onboarding-buddy", primary: false },
      { id: "pit-map-planner", label: "Pit Map Planner", legacyHref: "/pit-map-planner", primary: false },
      { id: "retro", label: "Team Retrospective", legacyHref: "/retro", primary: false },
      { id: "risk-burndown", label: "Risk-Register Burndown", legacyHref: "/risk-burndown", primary: false },
      { id: "safety-training", label: "Safety Training Tracker", legacyHref: "/safety-training", primary: false },
      { id: "skills-graph", label: "Skills & Mentorship Graph", legacyHref: "/skills-graph", primary: false },
      { id: "standup-digest", label: "Morning Standup Digest", legacyHref: "/standup-digest", primary: false },
      { id: "team-health-dashboard", label: "Team Health Dashboard", legacyHref: "/team-health-dashboard", primary: false },
      { id: "tool-checkout", label: "Tool Checkout", legacyHref: "/tool-checkout", primary: false },
    ],
  },
  {
    id: "business",
    href: "/business",
    label: "Business",
    title: "Business",
    description:
      "Budget, purchase orders, sponsor pipeline, sponsorship one-pagers, grants, partners, and award evidence — one season source of truth.",
    defaultTab: "overview",
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "budget", label: "Budget" },
      { id: "orders", label: "Orders", legacyHref: "/orders" },
      { id: "sponsors", label: "Sponsors" },
      { id: "sponsorship", label: "Sponsorship", legacyHref: "/sponsorship" },
      { id: "grants", label: "Grants", legacyHref: "/team/grants" },
      { id: "placements", label: "Partners" },
      { id: "evidence", label: "Awards" },
      { id: "costs", label: "Season Costs", legacyHref: "/costs", primary: false },
      { id: "fundraisers", label: "Fundraisers", legacyHref: "/fundraisers", primary: false },
      { id: "impact", label: "Community Impact", legacyHref: "/impact", primary: false },
      { id: "award-tracker", label: "Award Submission Tracker", legacyHref: "/award-tracker", primary: false },
      { id: "grant-report", label: "Grant Report", legacyHref: "/grant-report", primary: false },
      { id: "grants-workbench", label: "Grants workbench", legacyHref: "/team/grants", primary: false },
      { id: "awards-workbench", label: "Awards workbench", legacyHref: "/team/awards", primary: false },
      { id: "impact-essay", label: "FIRST Impact Essay Generator", legacyHref: "/impact-essay", primary: false },
      { id: "judge-sim", label: "Judge-Pitch Simulator", legacyHref: "/judge-sim", primary: false },
      { id: "media-kit", label: "Media Kit", legacyHref: "/media-kit", primary: false },
      { id: "outreach-calendar", label: "Outreach Calendar", legacyHref: "/outreach-calendar", primary: false },
      { id: "sponsor-suite", label: "Sponsor Suite", legacyHref: "/sponsor-suite", primary: false },
      { id: "sponsor-tier-calculator", label: "Sponsor Tier Calculator", legacyHref: "/sponsor-tier-calculator", primary: false },
      { id: "sponsor-wall", label: "Sponsor Wall", legacyHref: "/sponsor-wall", primary: false },
      { id: "vendor-lead-times", label: "Vendor Lead-Time Tracker", legacyHref: "/vendor-lead-times", primary: false },
    ],
  },
  {
    id: "build",
    href: "/build",
    label: "Build",
    title: "Build",
    description:
      "Kickoff, CAD, code coach, FMEA, prototypes, and battery ops — Soft-UI shop tools with Competition and AI cross-links.",
    defaultTab: "kickoff",
    tabs: [
      { id: "kickoff", label: "Kickoff", legacyHref: "/kickoff" },
      { id: "cad", label: "CAD", legacyHref: "/cad" },
      { id: "code", label: "Code", legacyHref: "/code" },
      { id: "fmea", label: "FMEA", legacyHref: "/fmea" },
      { id: "prototype", label: "Prototypes", legacyHref: "/prototype-tracker" },
      { id: "batteries", label: "Batteries", legacyHref: "/batteries" },
      { id: "auton-path-library", label: "Autonomous Path Library", legacyHref: "/auton-path-library", primary: false },
      { id: "battery-health-forecast", label: "Battery Health Forecast", legacyHref: "/battery-health-forecast", primary: false },
      { id: "budget-reconciler", label: "Budget Reconciler", legacyHref: "/budget-reconciler", primary: false },
      { id: "code-deploy-log", label: "Code Deploy Log", legacyHref: "/code-deploy-log", primary: false },
      { id: "code-perf", label: "Code-vs-Match Detective", legacyHref: "/code-perf", primary: false },
      { id: "cross-domain-alerts", label: "Cross-Domain Alerts", legacyHref: "/cross-domain-alerts", primary: false },
      { id: "decision-critic", label: "Decision Critic", legacyHref: "/decision-critic", primary: false },
      { id: "failure-patterns", label: "Repeat Failure Patterns", legacyHref: "/failure-patterns", primary: false },
      { id: "incident-heatmap", label: "Incident Heatmap", legacyHref: "/incident-heatmap", primary: false },
      { id: "inspection-copilot", label: "Inspection-Readiness Copilot", legacyHref: "/inspection-copilot", primary: false },
      { id: "readiness-score", label: "Robot Readiness Score", legacyHref: "/readiness-score", primary: false },
      { id: "reuse-advisor", label: "Reuse Advisor", legacyHref: "/reuse-advisor", primary: false },
      { id: "robot-weigh-in", label: "Robot Weigh-In Log", legacyHref: "/robot-weigh-in", primary: false },
      { id: "rule-impact", label: "Rule Impact Analyzer", legacyHref: "/rule-impact", primary: false },
      { id: "sketch-to-brief", label: "Sketch-to-Brief", legacyHref: "/sketch-to-brief", primary: false },
      { id: "spare-forecast", label: "Spare-Parts Failure Forecast", legacyHref: "/spare-forecast", primary: false },
      { id: "spare-robot-kit", label: "Spare Robot Kit Checklist", legacyHref: "/spare-robot-kit", primary: false },
      { id: "tuning-autopilot", label: "Tuning Autopilot", legacyHref: "/tuning-autopilot", primary: false },
      { id: "wiring-diagnoser", label: "Wiring / Power Fault Diagnoser", legacyHref: "/wiring-diagnoser", primary: false },
    ],
  },
  {
    id: "ai",
    href: "/ai",
    label: "AI",
    title: "AI",
    description:
      "Assistant chat, API budgets, grant/sponsor writer, code assist, memory, governance, finance-in-AI — and AI API keys in More tools.",
    defaultTab: "chat",
    tabs: [
      { id: "chat", label: "Chat", legacyHref: "/chat" },
      { id: "budgets", label: "Budgets", legacyHref: "/team/budgets" },
      { id: "writer", label: "Writer", legacyHref: "/writer" },
      { id: "code", label: "Code assist", legacyHref: "/code" },
      { id: "memory", label: "Memory", legacyHref: "/team/ai-memory" },
      { id: "governance", label: "Governance", legacyHref: "/team/ai-policy" },
      { id: "finance", label: "Finance" },
      { id: "ai-keys", label: "AI API keys", legacyHref: "/team/ai-keys", primary: false, featured: true },
      { id: "usage", label: "Usage", legacyHref: "/team/usage", primary: false },
      { id: "decisions", label: "Decision Log", legacyHref: "/decisions", primary: false },
      { id: "decision-search", label: "Decision Search", legacyHref: "/decision-search", primary: false },
      { id: "season-report", label: "Season Report", legacyHref: "/season-report", primary: false },
    ],
  },
];


export function hubById(id: ProductHubDef["id"]): ProductHubDef {
  const hub = PRODUCT_HUBS.find((entry) => entry.id === id);
  if (!hub) throw new Error(`Unknown hub: ${id}`);
  return hub;
}

export function isHubTab(hub: ProductHubDef, value: string | null | undefined): value is string {
  return Boolean(value && hub.tabs.some((tab) => tab.id === value));
}

export function hubPrimaryTabs(hub: ProductHubDef): HubTabDef[] {
  return hub.tabs.filter((tab) => tab.primary !== false);
}

export function hubMoreTabs(hub: ProductHubDef): HubTabDef[] {
  return hub.tabs.filter((tab) => tab.primary === false && tab.legacyHref);
}

/** Featured More-tools pins — Alliance desk / Season planning / AI keys, etc. */
export function hubFeaturedMoreTabs(hub: ProductHubDef): HubTabDef[] {
  return hubMoreTabs(hub).filter((tab) => tab.featured === true);
}

export function hubHref(hubPath: string, tab: string, orgId?: string | null): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (orgId) params.set("orgId", orgId);
  return `${hubPath}?${params.toString()}`;
}

export function hubLegacyHref(tab: HubTabDef, orgId?: string | null): string {
  const base = tab.legacyHref ?? "#";
  if (!orgId) return base;
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}orgId=${encodeURIComponent(orgId)}`;
}