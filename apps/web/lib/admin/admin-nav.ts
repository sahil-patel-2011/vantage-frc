/**
 * Platform admin navigation: one row, seven places. Shared by the navigation (a client
 * component) and the More page (a server component), so it lives outside both.
 *
 * It was four tabs over fourteen links, so finding a page meant guessing its tab first. The
 * operator's jobs are few: see what's wrong (Overview, Health), look after teams (Teams, AI
 * credits), read what people sent (Feedback), and decide who runs the platform (Platform
 * admins). Everything else (waitlist, analytics, audit, connectors, releases, outage contacts)
 * is under one quiet "More". Selling pages are gone: Vantage is free.
 */
export const ADMIN_DESTINATIONS = [
  { id: "overview", href: "/admin", label: "Overview" },
  { id: "teams", href: "/admin/teams", label: "Teams" },
  { id: "ai-credits", href: "/admin/ai-credits", label: "AI credits" },
  { id: "health", href: "/admin/health", label: "Health" },
  { id: "feedback", href: "/admin/feedback", label: "Feedback" },
  { id: "admins", href: "/admin/admins", label: "Platform admins" },
  { id: "more", href: "/admin/more", label: "More" },
] as const;

export type AdminDestinationId = (typeof ADMIN_DESTINATIONS)[number]["id"];

/** Pages reached from More: they light up More, so you always know where you are. */
export const MORE_PAGES = [
  { href: "/admin/waitlist", label: "Waitlist", detail: "People asking for a team" },
  { href: "/admin/analytics", label: "Analytics", detail: "How teams use Vantage" },
  { href: "/admin/audit", label: "Audit log", detail: "Everything platform admins did" },
  { href: "/admin/support", label: "Support", detail: "Help requests from teams" },
  { href: "/admin/partners", label: "Partners", detail: "Sponsors shown in the app" },
  { href: "/admin/outreach", label: "Outreach", detail: "Messages to teams" },
  { href: "/admin/connectors", label: "Data connectors", detail: "TBA, Statbotics and FIRST keys" },
  { href: "/admin/integrations", label: "Integrations", detail: "Google Sheets hub and bridges" },
  { href: "/admin/models", label: "Model control", detail: "Model catalog and AI bridges" },
  { href: "/admin/sponsored", label: "Sponsored AI", detail: "The free-model pool policy" },
  { href: "/admin/releases", label: "Releases", detail: "What's new notes" },
] as const;

/** Which destination the page belongs to. `/admin` itself is only the Overview. */
export function activeAdminDestination(pathname: string): AdminDestinationId {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return "overview";
  const match = ADMIN_DESTINATIONS.find((dest) => dest.href !== "/admin" && (path === dest.href || path.startsWith(`${dest.href}/`)));
  // Anything else under /admin is a More page (or one not filed yet): never a blank row.
  return match?.id ?? "more";
}

