/**
 * Canonical map of every settings surface in the product — the one place that
 * answers "where do I change X". Pure data + helpers, safe for client bundles.
 *
 * Personal entries are visible to every member; team entries require an
 * owner/admin role. `/team/ai-keys` intentionally appears in both scopes
 * (members manage their personal key there; admins also manage team keys) —
 * `visibleSettingsNav` dedupes it so one viewer never sees the page twice.
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
  {
    id: "my-ai-keys",
    label: "AI keys",
    href: "/team/ai-keys",
    icon: "bolt",
    scope: "personal",
    requiredRole: "member",
  },
  // Team — owner/admin only.
  { id: "team-admin", label: "Invites", href: "/team/admin", icon: "gear", scope: "team", requiredRole: "owner-admin" },
  {
    id: "member-access",
    label: "Member access",
    href: "/team/security",
    icon: "users",
    scope: "team",
    requiredRole: "owner-admin",
  },
  {
    id: "team-ai-keys",
    label: "AI keys & models",
    href: "/team/ai-keys",
    icon: "bolt",
    scope: "team",
    requiredRole: "owner-admin",
  },
  {
    id: "ai-budgets",
    label: "AI budgets",
    href: "/team/budgets",
    icon: "stats",
    scope: "team",
    requiredRole: "owner-admin",
  },
  {
    id: "ai-governance",
    label: "AI governance",
    href: "/team/ai-policy",
    icon: "clipboard",
    scope: "team",
    requiredRole: "owner-admin",
  },
  { id: "data-export", label: "Data export", href: "/exports", icon: "grid", scope: "team", requiredRole: "owner-admin" },
];

/** Map a raw org role ("owner" | "admin" | "scout" | "viewer" | null) to the nav tier. */
export function settingsRoleTier(role: string | null | undefined): SettingsRequiredRole {
  const normalized = (role ?? "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin" ? "owner-admin" : "member";
}

function pathOf(href: string): string {
  return href.split("#")[0]?.split("?")[0] ?? href;
}

function tabOf(href: string): string | null {
  const queryIndex = href.indexOf("?");
  if (queryIndex < 0) return null;
  return new URLSearchParams(href.slice(queryIndex + 1)).get("tab");
}

/**
 * Entries the given role may see, in Personal-then-Team order. When a team
 * entry covers the same page as a personal one (AI keys), the team entry wins
 * so an admin never sees two chips pointing at one page.
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
  return SETTINGS_NAV.some((item) => {
    const itemPath = pathOf(item.href);
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
    const itemTab = tabOf(item.href);
    const tabMatches =
      itemTab === null ? currentTab === null || currentTab === "profile" : currentTab === itemTab;
    if (!tabMatches) continue;
    if (itemPath.length > bestScore) {
      bestScore = itemPath.length;
      best = item;
    }
  }
  return best?.id ?? null;
}
