/**
 * Product navigation — single source of truth for the app-shell drawer,
 * command palette, and breadcrumb labels.
 *
 * Pillars: Competition · Scouting · Calendar · Build · Team · Logistics · Kickoff ·
 * Business · Settings
 * See docs/FEATURE_MAP.md for the full “where does X live?” map.
 */

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
  "/signin",
  "/sign-in",
]);

export const PRODUCT_NAV_GROUPS: ProductNavGroup[] = [
  {
    label: "Home",
    ...TONE,
    icon: "home",
    items: [
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/workspace", label: "Workspace", icon: "grid" },
      { href: "/chat", label: "Vantage AI", icon: "bolt" },
      { href: "/announcements", label: "Announcements", icon: "bell" },
    ],
  },
  {
    label: "Competition",
    ...TONE,
    icon: "swords",
    items: [
      { href: "/command", label: "Event Day", icon: "target" },
      { href: "/pit", label: "Pit Command", icon: "cube" },
      { href: "/batteries", label: "Batteries", icon: "bolt" },
      { href: "/incidents", label: "Incidents", icon: "gear" },
      { href: "/match-checklist", label: "Match Checklist", icon: "clipboard" },
      { href: "/intel", label: "Matches", icon: "swords" },
      { href: "/schedule", label: "Match Schedule", icon: "calendar" },
      { href: "/briefing", label: "Event Briefing", icon: "clipboard" },
      { href: "/match-debrief", label: "Match Debrief", icon: "chat" },
      { href: "/inspection", label: "Inspection", icon: "target" },
    ],
  },
  {
    label: "Scouting",
    ...TONE,
    icon: "scout",
    items: [
      { href: "/scouting", label: "Scouting Hub", icon: "clipboard" },
      { href: "/scouting/lineup", label: "Lineup & Coverage", icon: "target" },
      { href: "/intel", label: "Teams", icon: "users" },
      { href: "/strategy", label: "Strategy & AI", icon: "bolt" },
      { href: "/pick-clock", label: "Pick Clock", icon: "target" },
      { href: "/chemistry", label: "Alliance Chemistry", icon: "users" },
      { href: "/dossier", label: "Team Dossier", icon: "clipboard" },
      { href: "/rankings", label: "Rankings", icon: "stats" },
      { href: "/video", label: "Video Review", icon: "display" },
    ],
  },
  {
    label: "Calendar",
    ...TONE,
    icon: "calendar",
    items: [
      { href: "/team/calendar", label: "Team Calendar", icon: "calendar" },
      { href: "/calendar", label: "Season Calendar", icon: "calendar" },
      { href: "/practice", label: "Practice Planner", icon: "target" },
      { href: "/shifts", label: "Shifts", icon: "users" },
      { href: "/attendance", label: "Attendance", icon: "users" },
      { href: "/hours", label: "Build Hours", icon: "stats" },
    ],
  },
  {
    label: "Build",
    ...TONE,
    icon: "cube",
    items: [
      { href: "/cad", label: "AI CAD", icon: "cube", state: "setup" },
      { href: "/code", label: "Code", icon: "code" },
      { href: "/robot", label: "Robot Blueprint", icon: "gear" },
      { href: "/subsystems", label: "Subsystems", icon: "grid" },
      { href: "/fmea", label: "Failure Log (FMEA)", icon: "gear" },
      { href: "/display", label: "Displays", icon: "display" },
      { href: "/inventory", label: "Inventory & BOM", icon: "grid" },
      { href: "/vendors", label: "Vendors & Suppliers", icon: "clipboard" },
      { href: "/control-map", label: "Control Map", icon: "target" },
      { href: "/software-versions", label: "Software Versions", icon: "code" },
      { href: "/decisions", label: "Decisions", icon: "clipboard" },
      { href: "/parts-relay", label: "FRC Parts Relay", icon: "bolt", state: "planned" },
    ],
  },
  {
    label: "Team",
    ...TONE,
    icon: "users",
    items: [
      // Soft-UI board at `/todos`; `/tasks` remains the build-season task board.
      { href: "/todos", label: "Todos", icon: "clipboard" },
      { href: "/tasks", label: "Task board", icon: "clipboard" },
      { href: "/messages", label: "Messages", icon: "chat" },
      { href: "/goals", label: "Goals", icon: "target" },
      { href: "/risks", label: "Risk Register", icon: "bolt" },
      { href: "/roles", label: "Roles", icon: "users" },
      { href: "/team/knowledge", label: "Knowledge Base", icon: "clipboard" },
      { href: "/team/alumni", label: "Alumni", icon: "users" },
      { href: "/team", label: "Admin", icon: "gear" },
      { href: "/team/discord", label: "Discord", icon: "chat" },
      { href: "/team/data", label: "Data analytics", icon: "stats" },
      { href: "/team/usage", label: "AI usage", icon: "stats" },
      { href: "/training", label: "Training Matrix", icon: "users", state: "planned" },
      { href: "/leadership", label: "Leadership Continuity", icon: "users", state: "planned" },
      { href: "/retro", label: "Team Retrospective", icon: "chat", state: "planned" },
      { href: "/season-rollover", label: "Season Rollover", icon: "calendar", state: "planned" },
      { href: "/mock-judging", label: "Mock Judging", icon: "chat", state: "planned" },
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
      { href: "/travel", label: "Event Travel", icon: "pin", state: "planned" },
    ],
  },
  {
    label: "Kickoff",
    ...TONE,
    icon: "bolt",
    items: [{ href: "/kickoff", label: "Kickoff Summary", icon: "clipboard" }],
  },
  {
    label: "Business",
    ...TONE,
    icon: "clipboard",
    items: [
      { href: "/business", label: "Business Hub", icon: "clipboard" },
      { href: "/costs", label: "Season Costs", icon: "stats" },
      { href: "/team/finance", label: "Finance", icon: "stats" },
      { href: "/team/sponsors", label: "Sponsors", icon: "users" },
      { href: "/team/grants", label: "Grants", icon: "clipboard" },
      { href: "/team/awards", label: "Awards", icon: "target" },
      { href: "/fundraisers", label: "Fundraisers", icon: "bolt" },
      { href: "/impact", label: "Community Impact", icon: "target" },
      { href: "/writer", label: "Award Writer", icon: "chat" },
      { href: "/recognition", label: "Recognition", icon: "users" },
      { href: "/exports", label: "Exports", icon: "clipboard" },
    ],
  },
  {
    label: "Settings",
    ...TONE,
    icon: "gear",
    items: [
      { href: "/account", label: "Account", icon: "users" },
      { href: "/help", label: "Help & Support", icon: "chat" },
      { href: "/notifications", label: "Notifications", icon: "bell" },
      { href: "/security", label: "Security", icon: "gear" },
      { href: "/team/security", label: "Team security", icon: "gear" },
      { href: "/team/budgets", label: "API budgets", icon: "stats" },
      { href: "/team", label: "API keys & admin", icon: "gear" },
    ],
  },
];

/** Bottom island — keep glanceable; full IA lives in the drawer. */
export const PRIMARY_TABS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/command", label: "Event Day", icon: "target" },
  { href: "/scouting", label: "Scout", icon: "scout" },
  { href: "/team/calendar", label: "Calendar", icon: "calendar" },
];

export function withOrgHref(href: string, orgId: string | null | undefined): string {
  if (!orgId) return href;
  const pathOnly = href.split("?")[0] ?? href;
  if (ORG_EXEMPT_HREFS.has(pathOnly) || pathOnly.startsWith("/admin")) return href;
  if (href.includes("orgId=")) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}orgId=${encodeURIComponent(orgId)}`;
}

/** Longest matching nav href wins (so /team/security beats /team). */
export function findNavMatch(
  pathname: string,
): { group: ProductNavGroup; item: ProductNavItem } | null {
  const path = pathname.split("?")[0] || "/";
  let best: { group: ProductNavGroup; item: ProductNavItem; score: number } | null = null;
  for (const group of PRODUCT_NAV_GROUPS) {
    for (const item of group.items) {
      if (item.state === "planned") continue;
      const href = item.href;
      const exact = path === href;
      const nested = href !== "/" && path.startsWith(`${href}/`);
      if (!exact && !nested) continue;
      if (href === "/team" && nested) continue;
      if (exact && href === "/intel" && group.label === "Scouting") continue;
      if (exact && href === "/calendar" && group.label !== "Calendar") continue;
      const score = href.length + (exact ? 1_000 : 0);
      if (!best || score > best.score) best = { group, item, score };
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
