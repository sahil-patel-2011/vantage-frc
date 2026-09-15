/**
 * Canonical map of every settings surface in the product — the one place that
 * answers "where do I change X". Pure data + helpers, safe for client bundles.
 *
 * Personal entries are visible to every member; team entries require an
 * owner/admin role. Members do not get an AI-keys chip — Claude Code is the
 * no-key Ask AI path. Owners see one AI keys chip plus Chat, Team admin,
 * Member access, and Data export.
 */

import type { ProductNavIcon } from "./product-nav";

export type SettingsScope = "personal" | "team";
export type SettingsRequiredRole = "member" | "owner-admin";

export type SettingsNavItem = {
  id: string;
  label: string;
  href: string;
  icon: ProductNavIcon;
  scope: SettingsScope;
  requiredRole: SettingsRequiredRole;
};

export const SETTINGS_NAV: SettingsNavItem[] = [
  // Personal — every member.
  { id: "profile", label: "Profile", href: "/account", icon: "users", scope: "personal", requiredRole: "member" },
  {
    id: "appearance",
    label: "Appearance",
    href: "/account?tab=appearance",
    icon: "display",
    scope: "personal",
    requiredRole: "member",
  },
  {
    id: "notifications",
    label: "Notifications",
    href: "/account?tab=notifications",
    icon: "bell",
    scope: "personal",
    requiredRole: "member",
  },
  { id: "security", label: "Security", href: "/security", icon: "pin", scope: "personal", requiredRole: "member" },
  // Personal rather than team: a member whose own Onshape authorisation has
  // expired needs this page, and the deployment-level rows on it are read-only
  // facts they can pass to whoever runs the deployment.
  {
    id: "connectors",
    label: "Connectors",
    href: "/connectors",
    icon: "bolt",
    scope: "personal",
    requiredRole: "member",
  },
  // Team — owner/admin only. AI keys stay one chip (Claude Code is the no-key Ask AI path).
  { id: "team-admin", label: "Team admin", href: "/team/admin", icon: "gear", scope: "team", requiredRole: "owner-admin" },
  {
    id: "member-access",
    label: "Member access",
    href: "/team/security",
    icon: "users",
    scope: "team",
    requiredRole: "owner-admin",
  },
  {
    id: "chat",
    label: "Chat",
    href: "/messages?settings=1",
    icon: "users",
    scope: "team",
    requiredRole: "owner-admin",
  },
  {
    id: "team-ai-keys",
    label: "AI keys",
    href: "/team/ai-keys",
    icon: "bolt",
    scope: "team",
    requiredRole: "owner-admin",
  },
  { id: "data-export", label: "Data export", href: "/exports", icon: "grid", scope: "team", requiredRole: "owner-admin" },
];

/** Pages that still exist but are no longer chips — keep Settings highlighting. */
const SETTINGS_PATH_ALIASES = ["/team/budgets", "/team/ai-policy"];

/** Map a raw org role ("owner" | "admin" | "scout" | "viewer" | null) to the nav tier. */
export function settingsRoleTier(role: string | null | undefined): SettingsRequiredRole {
  const normalized = (role ?? "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin" ? "owner-admin" : "member";
}

function pathOf(href: string): string {
  return href.split("#")[0]?.split("?")[0] ?? href;
}

function queryOf(href: string): URLSearchParams {
  const queryIndex = href.indexOf("?");
  if (queryIndex < 0) return new URLSearchParams();
  return new URLSearchParams(href.slice(queryIndex + 1));
}

function tabOf(href: string): string | null {
  return queryOf(href).get("tab");
}

/**
 * Entries the given role may see, in Personal-then-Team order. When a team
 * entry covers the same page as a personal one, the team entry wins so an
 * admin never sees two chips pointing at one page.
 */
export function visibleSettingsNav(role: string | null | undefined, scope?: SettingsScope): SettingsNavItem[] {
  const tier = settingsRoleTier(role);
  const allowed = SETTINGS_NAV.filter((item) => item.requiredRole === "member" || tier === "owner-admin");
  const teamHrefs = new Set(allowed.filter((item) => item.scope === "team").map((item) => pathOf(item.href)));
  const deduped = allowed.filter(
    (item) => item.scope === "team" || !teamHrefs.has(pathOf(item.href)),
  );
  return scope ? deduped.filter((item) => item.scope === scope) : deduped;
}

/** Whether a pathname is one of the settings surfaces (segment-aware prefix). */
export function isSettingsPath(pathname: string): boolean {
  const path = pathOf(pathname);
  if (path === "/messages") return false;
  return [...SETTINGS_NAV.map((item) => pathOf(item.href)), ...SETTINGS_PATH_ALIASES].some((itemPath) => {
    return path === itemPath || path.startsWith(`${itemPath}/`);
  });
}

/**
 * Which entry of `items` is active for the current location. Longest path
 * prefix wins; among entries on the same path, the `tab` query decides —
 * no tab (or tab=profile) matches the entry without a tab in its href, and a
 * tab with no matching entry (e.g. /account?tab=integrations) activates none.
 */
export function activeSettingsId(
  items: SettingsNavItem[],
  pathname: string,
  search?: string | null,
): string | null {
  const path = pathOf(pathname);
  const currentTab = search ? new URLSearchParams(search.replace(/^\?/, "")).get("tab") : null;

  let best: SettingsNavItem | null = null;
  let bestScore = -1;
  for (const item of items) {
    const itemPath = pathOf(item.href);
    const onPath = path === itemPath || path.startsWith(`${itemPath}/`);
    if (!onPath) continue;
    const itemQuery = queryOf(item.href);
    const itemTab = itemQuery.get("tab");
    const itemSettings = itemQuery.get("settings");
    const currentSettings = search ? new URLSearchParams(search.replace(/^\?/, "")).get("settings") : null;
    const tabMatches =
      itemTab === null ? currentTab === null || currentTab === "profile" : currentTab === itemTab;
    const settingsMatches = itemSettings === null || currentSettings === itemSettings;
    if (!tabMatches || !settingsMatches) continue;
    if (itemPath.length > bestScore) {
      bestScore = itemPath.length;
      best = item;
    }
  }
  return best?.id ?? null;
}
