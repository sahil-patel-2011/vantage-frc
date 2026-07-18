/**
 * Product hubs — consolidate related surfaces behind Soft-UI TabBar shells.
 * Legacy routes redirect here (see apps/web/next.config.ts).
 */

export type HubTabDef = {
  id: string;
  label: string;
  legacyHref?: string;
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
    description: "Event day command, personal schedule, strategy, scouting, picks, and alliance chemistry.",
    defaultTab: "command",
    tabs: [
      { id: "command", label: "Command", legacyHref: "/command" },
      { id: "my-day", label: "My Day", legacyHref: "/my-day" },
      { id: "strategy", label: "Strategy", legacyHref: "/strategy" },
      { id: "scouting", label: "Scouting", legacyHref: "/scouting" },
      { id: "pick-clock", label: "Pick clock", legacyHref: "/pick-clock" },
      { id: "chemistry", label: "Chemistry", legacyHref: "/chemistry" },
    ],
  },
  {
    id: "team",
    href: "/team",
    label: "Team",
    title: "Team",
    description: "Calendar, todos, messages, practice, knowledge, and attendance — one place for day-to-day ops.",
    defaultTab: "calendar",
    tabs: [
      { id: "calendar", label: "Calendar", legacyHref: "/team/calendar" },
      { id: "todos", label: "Todos", legacyHref: "/tasks" },
      { id: "messages", label: "Messages", legacyHref: "/messages" },
      { id: "practice", label: "Practice", legacyHref: "/practice" },
      { id: "knowledge", label: "Knowledge", legacyHref: "/team/knowledge" },
      { id: "attendance", label: "Attendance", legacyHref: "/attendance" },
    ],
  },
  {
    id: "business",
    href: "/business",
    label: "Business",
    title: "Business",
    description: "Budget, orders, sponsorship, grants, and award evidence for the season.",
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
    ],
  },
  {
    id: "build",
    href: "/build",
    label: "Build",
    title: "Build",
    description: "Kickoff, CAD, code coach, FMEA, and battery ops for the robot shop.",
    defaultTab: "kickoff",
    tabs: [
      { id: "kickoff", label: "Kickoff", legacyHref: "/kickoff" },
      { id: "cad", label: "CAD", legacyHref: "/cad" },
      { id: "code", label: "Code", legacyHref: "/code" },
      { id: "fmea", label: "FMEA", legacyHref: "/fmea" },
      { id: "batteries", label: "Batteries", legacyHref: "/batteries" },
    ],
  },
  {
    id: "ai",
    href: "/ai",
    label: "AI",
    title: "AI",
    description: "Assistant chat, API budgets, governance, and the finance-in-AI opt-in.",
    defaultTab: "chat",
    tabs: [
      { id: "chat", label: "Chat", legacyHref: "/chat" },
      { id: "budgets", label: "Budgets", legacyHref: "/team/budgets" },
      { id: "governance", label: "Governance", legacyHref: "/team/ai-policy" },
      { id: "finance", label: "Finance" },
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

export function hubHref(hubPath: string, tab: string, orgId?: string | null): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (orgId) params.set("orgId", orgId);
  return `${hubPath}?${params.toString()}`;
}