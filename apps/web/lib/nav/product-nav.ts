/**
 * Product navigation — single source of truth for the app-shell drawer,
 * command palette, and breadcrumb labels.
 *
 * Pillars: Competition · Team · Logistics · Business · Build · AI
 * (+ Home entry + Settings). See docs/FEATURE_MAP.md.
 */

import { PRODUCT_HUBS } from "./hubs";

export type NavItemState = "setup" | "planned";

export type ProductNavItem = {
  href: string;
  label: string;
  icon: ProductNavIcon;
  state?: NavItemState;
};

export type ProductNavGroup = {
  label: string;
  tone: string;
  toneBg: string;
  icon: ProductNavIcon;
  items: ProductNavItem[];
};

export type ProductNavIcon =
  | "menu"
  | "search"
  | "bell"
  | "x"
  | "home"
  | "swords"
  | "scout"
  | "stats"
  | "chevron"
  | "chat"
  | "target"
  | "calendar"
  | "clipboard"
  | "users"
  | "bolt"
  | "cube"
  | "code"
  | "display"
  | "gear"
  | "grid"
  | "pin"
  | "back";

const TONE = { tone: "#1f4fd6", toneBg: "#e8eefc" } as const;

/** Routes that never append ?orgId= (account / platform chrome). */
export const ORG_EXEMPT_HREFS = new Set([
  "/dashboard",
  "/account",
  "/security",
  "/admin",
  "/notifications",
  "/help",
  "/support",
  "/signin",
  "/sign-in",
]);

/**
 * Consolidated IA — features grouped by job, not every page as a peer.
 * Duplicate destinations (e.g. /intel under Scouting, /calendar under Kickoff) are removed.
 */
export const PRODUCT_NAV_GROUPS: ProductNavGroup[] = [
  {
    label: "Home",
    ...TONE,
    icon: "home",
    items: [
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/start", label: "Your path", icon: "pin" },
      { href: "/workspace", label: "Workspace", icon: "grid" },
      { href: "/announcements", label: "Announcements", icon: "bell" },
    ],
  },
  {
    label: "Competition",
    ...TONE,
    icon: "swords",
    items: [
      { href: "/competition", label: "Competition hub", icon: "swords" },
      { href: "/competition?tab=command", label: "Command", icon: "target" },
      { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
      { href: "/competition?tab=strategy", label: "Strategy", icon: "stats" },
      { href: "/competition?tab=scouting", label: "Scouting", icon: "scout" },
      { href: "/competition?tab=forms", label: "Form builder", icon: "clipboard" },
      { href: "/competition?tab=match-checklist", label: "Match checklist", icon: "clipboard" },
      { href: "/competition?tab=scouting#scout-voice", label: "Voice notes", icon: "chat" },
      { href: "/scouting/lineup", label: "Lineup & Coverage", icon: "target" },
      { href: "/offline-shell", label: "Offline Shell", icon: "pin" },
      { href: "/ai?tab=budgets", label: "AI budgets", icon: "stats" },
      { href: "/intel", label: "Matches & Teams", icon: "swords" },
      { href: "/schedule", label: "Match Schedule", icon: "calendar" },
      { href: "/competition?tab=pick-clock", label: "Pick clock", icon: "target" },
      { href: "/competition?tab=chemistry", label: "Chemistry", icon: "users" },
      { href: "/alliance-selection-desk", label: "Alliance Selection Desk", icon: "swords" },
      { href: "/dossier", label: "Team Dossier", icon: "clipboard" },
      { href: "/rankings", label: "Rankings", icon: "stats" },
      { href: "/video", label: "Video Review", icon: "display" },
      { href: "/pit", label: "Pit Command", icon: "cube" },
      { href: "/incidents", label: "Incidents", icon: "gear" },
      { href: "/briefing", label: "Event Briefing", icon: "clipboard" },
      { href: "/match-debrief", label: "Match Debrief", icon: "chat" },
      { href: "/inspection", label: "Inspection", icon: "target" },
      { href: "/alliance-partner-brief", label: "Alliance-Partner Brief", icon: "swords" },
      { href: "/alliance-sim", label: "Alliance Sim", icon: "swords" },
      { href: "/battery-rotation", label: "Battery Rotation & Charge Planner", icon: "swords" },
      { href: "/counter-book", label: "Opponent Counter-book", icon: "swords" },
      { href: "/data-quality-scorecard", label: "Data Quality Scorecard", icon: "swords" },
      { href: "/defense-planner", label: "Defense Planner", icon: "swords" },
      { href: "/drive-team-signals", label: "Drive-Team Signal Board", icon: "swords" },
      { href: "/epa-trend-alerts", label: "EPA Trend Alerts", icon: "swords" },
      { href: "/event-day-plan", label: "Event-Day Stress Planner", icon: "swords" },
      { href: "/match-copilot", label: "Match Copilot", icon: "swords" },
      { href: "/match-delta-watcher", label: "Match-Delta Watcher", icon: "swords" },
      { href: "/match-notes-timeline", label: "Match Note Timeline", icon: "swords" },
      { href: "/match-sim", label: "Match Simulator", icon: "swords" },
      { href: "/match-strategy-cards", label: "Match Strategy Cards", icon: "swords" },
      { href: "/match-video-index", label: "Match Video Index", icon: "swords" },
      { href: "/opponent-watchlist", label: "Opponent Watchlist", icon: "swords" },
      { href: "/overnight-intel", label: "Overnight Event-Intel Brief", icon: "swords" },
      { href: "/picklist-collab", label: "Collaborative Pick List", icon: "swords" },
      { href: "/picklist-justifier", label: "Pick-list Auto-Justifier", icon: "swords" },
      { href: "/pit-repair-triage", label: "Pit Repair Triage", icon: "swords" },
      { href: "/scout-accuracy", label: "Scout Accuracy", icon: "swords" },
      { href: "/scout-assisted-count", label: "Scout-Assisted Count", icon: "swords" },
      { href: "/scout-coverage-live", label: "Scout Coverage Live", icon: "swords" },
      { href: "/scout-crossval", label: "Scout Cross-Validation", icon: "swords" },
      { href: "/scout-data-impact", label: "Scout Data Impact", icon: "swords" },
      { href: "/scout-disagreements", label: "Scout Disagreements", icon: "swords" },
      { href: "/scout-field-budget", label: "Scouting Field-Count Budget", icon: "swords" },
      { href: "/scout-p2p-relay", label: "Scout P2P Relay", icon: "swords" },
      { href: "/scout-schema-negotiate", label: "Scout Schema Negotiate", icon: "swords" },
      { href: "/scout-training-mode", label: "Scout Training Mode", icon: "swords" },
      { href: "/scouting-heat-signals", label: "Scouting Heat Signals", icon: "swords" },
      { href: "/scouting-schema-ab", label: "Scouting Schema A/B", icon: "swords" },
      { href: "/shift-balancer", label: "Scout Shift Load Balancer", icon: "swords" },
    ],
  },
  {
    label: "Team",
    ...TONE,
    icon: "users",
    items: [
      { href: "/team", label: "Team hub", icon: "users" },
      { href: "/team?tab=calendar", label: "Calendar", icon: "calendar" },
      { href: "/calendar", label: "Season Calendar", icon: "calendar" },
      { href: "/team?tab=practice", label: "Practice", icon: "target" },
      { href: "/shifts", label: "Shifts", icon: "users" },
      { href: "/team?tab=attendance", label: "Attendance", icon: "users" },
      { href: "/hours", label: "Build Hours", icon: "stats" },
      { href: "/team?tab=todos", label: "Todos", icon: "clipboard" },
      { href: "/team?tab=messages", label: "Messages", icon: "chat" },
      { href: "/goals", label: "Goals", icon: "target" },
      { href: "/season-planning-workspace", label: "Season Planning Workspace", icon: "calendar" },
      { href: "/risks", label: "Risk Register", icon: "bolt" },
      { href: "/roles", label: "Roles", icon: "users" },
      { href: "/team/getting-started", label: "Team setup", icon: "pin" },
      { href: "/team?tab=knowledge", label: "Knowledge", icon: "clipboard" },
      { href: "/team?tab=batteries", label: "Batteries", icon: "bolt" },
      { href: "/team?tab=fmea", label: "FMEA", icon: "bolt" },
      { href: "/team/alumni", label: "Alumni", icon: "users" },
      { href: "/team/admin", label: "Admin", icon: "gear" },
      { href: "/team/discord", label: "Discord", icon: "chat" },
      { href: "/team/data", label: "Data analytics", icon: "stats" },
      { href: "/training", label: "Training Matrix", icon: "users" },
      { href: "/leadership", label: "Leadership Continuity", icon: "users" },
      { href: "/retro", label: "Team Retrospective", icon: "chat" },
      { href: "/season-rollover", label: "Season Rollover", icon: "calendar" },
      { href: "/mock-judging", label: "Mock Judging", icon: "chat" },
      { href: "/alumni-network", label: "Alumni Network", icon: "users" },
      { href: "/bus-factor", label: "Bus-Factor & Burnout Watch", icon: "users" },
      { href: "/checklist-library", label: "Checklist Library", icon: "users" },
      { href: "/cross-team-scrim", label: "Cross-Team Scrim Scheduling", icon: "users" },
      { href: "/degraded-mode", label: "Data-Source Degraded Mode", icon: "users" },
      { href: "/driver-tryouts", label: "Driver Tryouts", icon: "users" },
      { href: "/equipment-maintenance", label: "Equipment Maintenance", icon: "users" },
      { href: "/exit-interview", label: "Graduation Exit Interviews", icon: "users" },
      { href: "/field-reset-timer", label: "Field Reset Timer", icon: "users" },
      { href: "/goals-tracker", label: "Season Goals Tracker", icon: "users" },
      { href: "/hours-self-view", label: "My Hours (Self-View & Kiosk)", icon: "users" },
      { href: "/knowledge-gap", label: "Knowledge-gap detective", icon: "users" },
      { href: "/meeting-autopilot", label: "Meeting-Agenda Autopilot", icon: "users" },
      { href: "/mentor-hours", label: "Mentor Hours & Engagement", icon: "users" },
      { href: "/object-chat-bridge", label: "Object Chat Bridge", icon: "users" },
      { href: "/offline-shell", label: "Offline Shell", icon: "users" },
      { href: "/onboarding-buddy", label: "Onboarding Buddy", icon: "users" },
      { href: "/pit-map-planner", label: "Pit Map Planner", icon: "users" },
      { href: "/risk-burndown", label: "Risk-Register Burndown", icon: "users" },
      { href: "/safety-training", label: "Safety Training Tracker", icon: "users" },
      { href: "/skills-graph", label: "Skills & Mentorship Graph", icon: "users" },
      { href: "/standup-digest", label: "Morning Standup Digest", icon: "users" },
      { href: "/team-health-dashboard", label: "Team Health Dashboard", icon: "users" },
      { href: "/tool-checkout", label: "Tool Checkout", icon: "users" },
    ],
  },
  {
    label: "Logistics",
    ...TONE,
    icon: "pin",
    items: [
      { href: "/logistics", label: "Event Logistics", icon: "pin" },
      { href: "/packing", label: "Packing List", icon: "grid" },
      { href: "/duties", label: "Duty Roster", icon: "users" },
      { href: "/visit-invites", label: "Visit Invites", icon: "users" },
    ],
  },
  {
    label: "Business",
    ...TONE,
    icon: "clipboard",
    items: [
      { href: "/business", label: "Business Hub", icon: "clipboard" },
      { href: "/business?tab=orders", label: "Orders", icon: "clipboard" },
      { href: "/business?tab=budget", label: "Budget", icon: "stats" },
      { href: "/business?tab=sponsors", label: "Sponsors", icon: "users" },
      { href: "/business?tab=sponsorship", label: "Sponsorship", icon: "clipboard" },
      { href: "/business?tab=grants", label: "Grants", icon: "clipboard" },
      { href: "/business?tab=evidence", label: "Awards evidence", icon: "target" },
      { href: "/costs", label: "Season Costs", icon: "stats" },
      { href: "/team/grants", label: "Grants workbench", icon: "clipboard" },
      { href: "/team/awards", label: "Awards workbench", icon: "target" },
      { href: "/fundraisers", label: "Fundraisers", icon: "bolt" },
      { href: "/impact", label: "Community Impact", icon: "target" },
      { href: "/recognition", label: "Recognition", icon: "users" },
      { href: "/exports", label: "Exports", icon: "clipboard" },
      { href: "/award-tracker", label: "Award Submission Tracker", icon: "clipboard" },
      { href: "/grant-report", label: "Grant Report", icon: "clipboard" },
      { href: "/impact-essay", label: "FIRST Impact Essay Generator", icon: "clipboard" },
      { href: "/judge-sim", label: "Judge-Pitch Simulator", icon: "clipboard" },
      { href: "/media-kit", label: "Media Kit", icon: "clipboard" },
      { href: "/outreach-calendar", label: "Outreach Calendar", icon: "clipboard" },
      { href: "/sponsor-suite", label: "Sponsor Suite", icon: "clipboard" },
      { href: "/sponsor-tier-calculator", label: "Sponsor Tier Calculator", icon: "clipboard" },
      { href: "/sponsor-wall", label: "Sponsor Wall", icon: "clipboard" },
      { href: "/vendor-lead-times", label: "Vendor Lead-Time Tracker", icon: "clipboard" },
    ],
  },
  {
    label: "Build",
    ...TONE,
    icon: "cube",
    items: [
      { href: "/build", label: "Build hub", icon: "cube" },
      { href: "/build?tab=kickoff", label: "Kickoff", icon: "bolt" },
      { href: "/build?tab=cad", label: "CAD", icon: "cube", state: "setup" },
      { href: "/build?tab=code", label: "Code", icon: "code" },
      { href: "/build?tab=fmea", label: "FMEA", icon: "gear" },
      { href: "/build?tab=prototype", label: "Prototypes", icon: "cube" },
      { href: "/build?tab=batteries", label: "Batteries", icon: "bolt" },
      { href: "/robot", label: "Robot Blueprint", icon: "gear" },
      { href: "/subsystems", label: "Subsystems", icon: "grid" },
      { href: "/display", label: "Displays", icon: "display" },
      { href: "/inventory", label: "Inventory & BOM", icon: "grid" },
      { href: "/vendors", label: "Vendors & Suppliers", icon: "clipboard" },
      { href: "/control-map", label: "Control Map", icon: "target" },
      { href: "/software-versions", label: "Software Versions", icon: "code" },
      { href: "/decisions", label: "Decisions", icon: "clipboard" },
      { href: "/parts-relay", label: "FRC Parts Relay", icon: "bolt" },
      { href: "/auton-path-library", label: "Autonomous Path Library", icon: "cube" },
      { href: "/battery-health-forecast", label: "Battery Health Forecast", icon: "cube" },
      { href: "/budget-reconciler", label: "Budget Reconciler", icon: "cube" },
      { href: "/build-burndown", label: "Build-Season Burndown", icon: "cube" },
      { href: "/code-deploy-log", label: "Code Deploy Log", icon: "cube" },
      { href: "/code-perf", label: "Code-vs-Match Detective", icon: "cube" },
      { href: "/cross-domain-alerts", label: "Cross-Domain Alerts", icon: "cube" },
      { href: "/decision-critic", label: "Decision Critic", icon: "cube" },
      { href: "/failure-patterns", label: "Repeat Failure Patterns", icon: "cube" },
      { href: "/incident-heatmap", label: "Incident Heatmap", icon: "cube" },
      { href: "/inspection-copilot", label: "Inspection-Readiness Copilot", icon: "cube" },
      { href: "/readiness-score", label: "Robot Readiness Score", icon: "cube" },
      { href: "/reuse-advisor", label: "Reuse Advisor", icon: "cube" },
      { href: "/robot-weigh-in", label: "Robot Weigh-In Log", icon: "cube" },
      { href: "/rule-impact", label: "Rule Impact Analyzer", icon: "cube" },
      { href: "/sketch-to-brief", label: "Sketch-to-Brief", icon: "cube" },
      { href: "/spare-forecast", label: "Spare-Parts Failure Forecast", icon: "cube" },
      { href: "/spare-robot-kit", label: "Spare Robot Kit Checklist", icon: "cube" },
      { href: "/tuning-autopilot", label: "Tuning Autopilot", icon: "cube" },
      { href: "/wiring-diagnoser", label: "Wiring / Power Fault Diagnoser", icon: "cube" },
      { href: "/subsystem-signoff", label: "Subsystem Sign-off", icon: "cube" },
    ],
  },
  {
    label: "AI",
    ...TONE,
    icon: "bolt",
    items: [
      { href: "/ai", label: "AI hub", icon: "bolt" },
      { href: "/ai?tab=chat", label: "Chat", icon: "chat" },
      { href: "/ai?tab=budgets", label: "Budgets", icon: "stats" },
      { href: "/ai?tab=writer", label: "Award Writer", icon: "chat" },
      { href: "/ai?tab=code", label: "Code assist", icon: "cube" },
      { href: "/ai?tab=memory", label: "Memory", icon: "clipboard" },
      { href: "/ai?tab=governance", label: "Governance", icon: "gear" },
      { href: "/ai?tab=finance", label: "Finance toggle", icon: "stats" },
      { href: "/team/usage", label: "AI usage", icon: "stats" },
      { href: "/team/ai-keys", label: "AI API keys", icon: "gear" },
      { href: "/decision-search", label: "Decision Search", icon: "bolt" },
      { href: "/season-report", label: "Season Report", icon: "bolt" },
    ],
  },
  {
    label: "Settings",
    ...TONE,
    icon: "gear",
    items: [
      { href: "/account", label: "Account", icon: "users" },
      { href: "/whats-new", label: "What’s new", icon: "bell" },
      { href: "/support", label: "Help & Support", icon: "chat" },
      { href: "/notifications", label: "Notifications", icon: "bell" },
      { href: "/security", label: "Security", icon: "gear" },
      { href: "/team/security", label: "Team security", icon: "gear" },
      { href: "/team/background", label: "Team background", icon: "users" },
      { href: "/ai?tab=budgets", label: "API budgets", icon: "stats" },
      { href: "/team/ai-keys", label: "AI API keys", icon: "gear" },
      { href: "/team/admin", label: "Custom providers & admin", icon: "gear" },
    ],
  },
];

/** Bottom island — glanceable; full IA lives in the drawer / More sheet. */
export type IslandTabDefinition = { href: string; label: string; icon: ProductNavIcon };

export const PRIMARY_TABS: IslandTabDefinition[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/competition", label: "Compete", icon: "swords" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/business", label: "Business", icon: "clipboard" },
];

/** Allowlisted destinations for the four personal island slots. */
export const ISLAND_TAB_CATALOG: IslandTabDefinition[] = [
  ...PRIMARY_TABS,
  { href: "/build", label: "Build", icon: "cube" },
  { href: "/ai", label: "AI", icon: "bolt" },
  { href: "/competition?tab=scouting", label: "Scout", icon: "scout" },
  { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
  { href: "/logistics", label: "Logistics", icon: "pin" },
  { href: "/team?tab=messages", label: "Messages", icon: "chat" },
];

/**
 * Six Soft-UI pillars for the More sheet / drawer — readable hierarchy first.
 * Competition · Team · Logistics · Business · Build · AI
 */
export const PILLAR_SHEET_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/competition", label: "Competition", icon: "swords" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/logistics", label: "Logistics", icon: "pin" },
  { href: "/business", label: "Business", icon: "clipboard" },
  { href: "/build", label: "Build", icon: "cube" },
  { href: "/ai", label: "AI", icon: "bolt" },
];

/** Glanceable ops shortcuts under the pillars — keep short to avoid clutter. */
export const MORE_SHEET_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
  { href: "/competition?tab=forms", label: "Forms", icon: "clipboard" },
  { href: "/competition?tab=match-checklist", label: "Checklist", icon: "clipboard" },
  { href: "/team?tab=messages", label: "Messages", icon: "chat" },
];

/** Newly polished Soft-UI tools — discoverable without dumping the full catalog. */
export const FEATURED_SOFT_UI_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/alliance-selection-desk", label: "Alliance desk", icon: "swords" },
  { href: "/season-planning-workspace", label: "Season planning", icon: "calendar" },
  { href: "/team/ai-keys", label: "AI API keys", icon: "gear" },
  { href: "/writer", label: "Writer", icon: "bolt" },
];

export function withOrgHref(href: string, orgId: string | null | undefined): string {
  if (!orgId) return href;
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const pathOnly = withoutHash.split("?")[0] ?? withoutHash;
  if (ORG_EXEMPT_HREFS.has(pathOnly) || pathOnly.startsWith("/admin")) return href;
  if (withoutHash.includes("orgId=")) return href;
  const join = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${join}orgId=${encodeURIComponent(orgId)}${hash}`;
}

/**
 * Keep the current path/query (tabs, filters) but force a selected workspace orgId.
 * Used by the Soft-UI account menu when switching team workspaces.
 */
export function withSelectedOrgHref(href: string, orgId: string): string {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const pathOnly = withoutHash.split("?")[0] ?? withoutHash;
  if (ORG_EXEMPT_HREFS.has(pathOnly) || pathOnly.startsWith("/admin")) {
    return `${pathOnly}${hash}`;
  }
  const query = withoutHash.includes("?") ? withoutHash.slice(withoutHash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  params.set("orgId", orgId);
  return `${pathOnly}?${params.toString()}${hash}`;
}

/** Path portion of a nav href (hubs use ?tab=). */
function navPathOnly(href: string): string {
  return href.split("?")[0] || href;
}

/**
 * Longest matching nav href wins (so /team/security beats /team).
 * Also resolves Soft-UI hub legacy paths (/command → Competition / Command)
 * via PRODUCT_HUBS.legacyHref when the live href is a ?tab= destination.
 */
export function findNavMatch(
  pathname: string,
): { group: ProductNavGroup; item: ProductNavItem } | null {
  const path = pathname.split("?")[0] || "/";
  let best: { group: ProductNavGroup; item: ProductNavItem; score: number } | null = null;

  for (const group of PRODUCT_NAV_GROUPS) {
    for (const item of group.items) {
      if (item.state === "planned") continue;
      const hrefPath = navPathOnly(item.href);
      const exact = path === hrefPath;
      const nested = hrefPath !== "/" && path.startsWith(`${hrefPath}/`);
      if (!exact && !nested) continue;
      // Prefer specific Team routes over the hub root for nested paths.
      if (hrefPath === "/team" && nested) continue;
      if (exact && hrefPath === "/team" && group.label === "Settings") continue;
      // Prefer concrete hub tabs over bare hub roots when path is exactly the hub.
      const score =
        hrefPath.length +
        (exact ? 1_000 : 0) +
        (item.href.includes("?") ? -50 : 0) +
        (exact && !item.href.includes("?") ? 100 : 0);
      if (!best || score > best.score) best = { group, item, score };
    }
  }

  // Legacy Soft-UI redirects: /scouting, /kickoff, /messages, …
  if (!best || best.score < 1_000) {
    for (const hub of PRODUCT_HUBS) {
      for (const tab of hub.tabs) {
        if (!tab.legacyHref || path !== tab.legacyHref) continue;
        const group = PRODUCT_NAV_GROUPS.find((entry) => entry.label === hub.label);
        const item = group?.items.find(
          (entry) => entry.href === `${hub.href}?tab=${tab.id}` || navPathOnly(entry.href) === tab.legacyHref,
        );
        if (group && item) {
          return { group, item };
        }
        if (group) {
          return {
            group,
            item: {
              href: `${hub.href}?tab=${tab.id}`,
              label: tab.label,
              icon: group.icon,
            },
          };
        }
      }
    }
  }

  return best ? { group: best.group, item: best.item } : null;
}

export function breadcrumbForPath(pathname: string): string {
  const match = findNavMatch(pathname);
  if (!match) return "Vantage";
  return `${match.group.label} / ${match.item.label}`;
}

export function navTitleForPath(pathname: string): string | null {
  const match = findNavMatch(pathname);
  return match?.item.label ?? null;
}

export function flattenNavItems(includePlanned = false): ProductNavItem[] {
  return PRODUCT_NAV_GROUPS.flatMap((group) =>
    group.items.filter((item) => includePlanned || item.state !== "planned"),
  );
}
