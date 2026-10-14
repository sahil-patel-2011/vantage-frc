/**
 * Settings: one place, like a phone's Settings app. Every settings surface in the product, in
 * two groups — "You" (every member) and "This team" (what the person's role allows) — in the
 * order the Settings column and the Settings list show them. Pure data + helpers, safe for
 * client bundles.
 *
 * The pages keep their own routes (/account, /security, /team/admin …); the settings layout
 * (components/settings-layout.tsx) puts them in one frame with this list beside them, and
 * /settings is the list itself. Entries with a #hash jump to a part of a page; they never mark
 * themselves as the current section.
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
  /** One plain line under the label in the Settings list. */
  detail: string;
  /** Only the team's owner (Delete team). */
  ownerOnly?: boolean;
  /** Red, at the bottom of its group. */
  danger?: boolean;
  /** Words people search for that are not in the label ("invite", "dark mode", "API key"). */
  keywords: string[];
};

/** The entry point: the grouped list on phones, the start page on desktop. */
export const SETTINGS_HREF = "/settings";

export const SETTINGS_GROUP_LABELS: Record<SettingsScope, string> = {
  personal: "You",
  team: "This team",
};

export const SETTINGS_NAV: SettingsNavItem[] = [
  // You — every member.
  { id: "profile", label: "Profile", href: "/account", icon: "users", scope: "personal", requiredRole: "member",
    detail: "Your personal details, sign-in and recovery",
    keywords: ["profile", "my name", "name", "email", "phone", "recovery email", "account", "me"] },
  { id: "appearance", label: "Appearance", href: "/account?tab=appearance", icon: "display", scope: "personal", requiredRole: "member",
    detail: "Light or dark, motion, and your pinned apps",
    keywords: ["appearance", "theme", "dark mode", "light mode", "colors", "motion", "density", "your apps", "pinned apps", "shortcuts", "bottom bar"] },
  { id: "notifications", label: "Notifications", href: "/notifications/preferences", icon: "bell", scope: "personal", requiredRole: "member",
    detail: "What we tell you about, and how",
    keywords: ["notifications", "alerts", "email alerts", "push", "notification settings", "mute"] },
  { id: "security", label: "Security", href: "/security", icon: "shield", scope: "personal", requiredRole: "member",
    detail: "Your sign-in, a second step, and your devices",
    keywords: ["security", "two factor", "2fa", "mfa", "authenticator", "password", "sessions", "signed in devices", "sign out everywhere"] },
  { id: "teams", label: "Your teams", href: "/account/teams", icon: "grid", scope: "personal", requiredRole: "member",
    detail: "Switch teams, join one, or leave one",
    keywords: ["your teams", "my teams", "switch team", "leave team", "join a team", "invitation"] },
  // Personal rather than team: a member whose own Onshape authorisation has expired needs this
  // page, and the deployment-level rows on it are read-only facts they can pass on.
  { id: "connectors", label: "Connectors", href: "/connectors", icon: "globe", scope: "personal", requiredRole: "member",
    detail: "Onshape, Google, GitHub and other linked tools",
    keywords: ["connectors", "integrations", "onshape", "google", "github", "the blue alliance", "tba", "slack", "discord", "connect"] },
  // A person's own key and the team's keys are the same page, two sections. The focus
  // query is what marks the right row; owners and mentors see both.
  { id: "my-ai-keys", label: "Your AI key", href: "/team/ai-keys?focus=yours", icon: "sparkles", scope: "personal", requiredRole: "member",
    detail: "Your provider keys, with optional sharing",
    keywords: ["my ai key", "personal key", "api key", "my api key", "gemini key", "openai key", "anthropic key"] },
  { id: "delete-account", label: "Delete account", href: "/account#delete-account", icon: "trash", scope: "personal", requiredRole: "member",
    detail: "Remove your account for good", danger: true,
    keywords: ["delete account", "delete my account", "remove my account", "close account"] },

  // This team — owners and mentors (owner-admin). Delete team is the owner's alone.
  { id: "team-ai-keys", label: "Team AI keys", href: "/team/ai-keys", icon: "sparkles", scope: "team", requiredRole: "owner-admin",
    detail: "Keys the whole team uses, and which models to try",
    keywords: ["ai keys", "team key", "api key", "models", "model routing", "openai", "anthropic", "gemini", "openrouter"] },
  { id: "ai-limits", label: "AI limits", href: "/team/budgets", icon: "bolt", scope: "team", requiredRole: "owner-admin",
    detail: "Set the team's AI spending limits and caching",
    keywords: ["ai limits", "chat limits", "spending", "budget", "caching", "pause ai"] },
  { id: "ai-usage", label: "AI usage", href: "/team/usage", icon: "activity", scope: "team", requiredRole: "owner-admin",
    detail: "Review the team's AI usage",
    keywords: ["ai usage", "usage log", "tokens", "ai cost"] },
  { id: "team-admin", label: "Members and invites", href: "/team/admin", icon: "users", scope: "team", requiredRole: "owner-admin",
    detail: "Invite people and choose what each can do",
    keywords: ["members", "invite", "invites", "add someone", "add member", "people", "team admin", "remove member", "roles"] },
  { id: "access-roles", label: "Access and roles", href: "/team/admin/presets", icon: "shield", scope: "team", requiredRole: "owner-admin",
    detail: "Custom roles and scouting leads",
    keywords: ["access", "custom roles", "permissions", "scouting lead", "access presets", "delegate"] },
  { id: "money-managers", label: "Money managers", href: "/team/admin#money-managers", icon: "stats", scope: "team", requiredRole: "owner-admin",
    detail: "Who can change the team's money",
    keywords: ["money managers", "finance managers", "budget access", "treasurer", "who can spend"] },
  { id: "join-code", label: "Join code", href: "/team/admin#join-code", icon: "bolt", scope: "team", requiredRole: "owner-admin",
    detail: "A code or link people use to join",
    keywords: ["join code", "join link", "team code", "invite link", "share code"] },
  { id: "member-access", label: "Team security", href: "/team/security", icon: "shield", scope: "team", requiredRole: "owner-admin",
    detail: "How everyone on the team signs in",
    keywords: ["team security", "sign in policy", "require 2fa", "allowed domains", "member access"] },
  { id: "chat", label: "Chat safety", href: "/messages/moderation", icon: "chat", scope: "team", requiredRole: "owner-admin",
    detail: "Reports and private-message rules",
    keywords: ["chat safety", "moderation", "reports", "private messages", "block", "youth protection"] },
  { id: "team-data", label: "Team data and export", href: "/team/data", icon: "database", scope: "team", requiredRole: "owner-admin",
    detail: "What the team has recorded; download it",
    keywords: ["team data", "export", "download data", "csv", "zip", "backup", "takeout", "event data"] },
  { id: "delete-team", label: "Delete team", href: "/team/admin/profile#team-delete-title", icon: "trash", scope: "team", requiredRole: "owner-admin",
    detail: "Remove this team and its data", danger: true, ownerOnly: true,
    keywords: ["delete team", "remove team", "close team", "shut down team"] },
];

/** Small, task-based groups shared by the directory and the section selector. */
export function settingsNavGroups(items: SettingsNavItem[]) {
  const groups = [
    { label: "Your account", ids: ["profile", "security", "teams"] },
    { label: "Preferences", ids: ["appearance", "notifications"] },
    { label: "Connections and your AI", ids: ["connectors", "my-ai-keys"] },
    { label: "Team · People and access", ids: ["team-admin", "access-roles", "money-managers", "join-code", "member-access", "chat"] },
    { label: "Team · AI", ids: ["team-ai-keys", "ai-limits", "ai-usage"] },
    { label: "Team · Data", ids: ["team-data"] },
    { label: "Account and team removal", ids: ["delete-account", "delete-team"] },
  ];
  return groups.map(group => ({ label: group.label, items: group.ids.flatMap(id => items.filter(item => item.id === id)) }))
    .filter(group => group.items.length > 0);
}

/** Pages that are not a row of their own but belong to one (they keep Settings around them). */
const SETTINGS_PATH_ALIASES: Record<string, string> = {
  "/exports": "team-data",
  "/team/ai-policy": "team-ai-keys",
};

/** Map a raw org role ("owner" | "admin" | "scout" | "viewer" | null) to the nav tier. */
export function settingsRoleTier(role: string | null | undefined): SettingsRequiredRole {
  const normalized = (role ?? "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin" ? "owner-admin" : "member";
}

function pathOf(href: string): string {
  return href.split("#")[0]?.split("?")[0] ?? href;
}

function queryOf(href: string): URLSearchParams {
  const path = href.split("#")[0] ?? href;
  const queryIndex = path.indexOf("?");
  if (queryIndex < 0) return new URLSearchParams();
  return new URLSearchParams(path.slice(queryIndex + 1));
}

/**
 * Entries the given role may see, You first, then This team. A personal row whose address is
 * exactly a team row's address is hidden, so one page is not listed twice. Your AI key and
 * Team AI keys differ by the focus query, so owners see both.
 */
export function visibleSettingsNav(role: string | null | undefined, scope?: SettingsScope): SettingsNavItem[] {
  const tier = settingsRoleTier(role);
  const owner = (role ?? "").trim().toLowerCase() === "owner";
  const allowed = SETTINGS_NAV.filter(
    (item) => (item.requiredRole === "member" || tier === "owner-admin") && (!item.ownerOnly || owner),
  );
  const teamPages = new Set(allowed.filter((item) => item.scope === "team").map((item) => item.href));
  const deduped = allowed.filter((item) => item.scope === "team" || !teamPages.has(item.href));
  return scope ? deduped.filter((item) => item.scope === scope) : deduped;
}

/** Whether a pathname is one of the settings surfaces (segment-aware prefix). */
export function isSettingsPath(pathname: string): boolean {
  const path = pathOf(pathname);
  if (path === "/messages") return false;
  return [SETTINGS_HREF, ...SETTINGS_NAV.map((item) => pathOf(item.href)), ...Object.keys(SETTINGS_PATH_ALIASES)].some(
    (itemPath) => path === itemPath || path.startsWith(`${itemPath}/`),
  );
}

/**
 * Which entry of `items` is the current section. Longest path prefix wins; among entries on
 * the same path, the `tab` query decides — no tab (or tab=profile) matches the entry without a
 * tab, and a tab with no matching entry (e.g. /account?tab=integrations) marks none. Entries
 * with a #hash are jumps within a page and are never the current one.
 */
export function activeSettingsId(
  items: SettingsNavItem[],
  pathname: string,
  search?: string | null,
): string | null {
  const path = pathOf(pathname);
  const params = new URLSearchParams((search ?? "").replace(/^\?/, ""));
  const currentTab = params.get("tab");
  const currentSettings = params.get("settings");
  const currentFocus = params.get("focus");
  // The legacy /team/budgets address redirects here; this tab uses the Settings frame.
  if (path === "/ai" && currentTab === "budgets" && items.some(item => item.id === "ai-limits")) return "ai-limits";

  let best: SettingsNavItem | null = null;
  let bestScore = -1;
  for (const item of items) {
    if (item.href.includes("#")) continue;
    const itemPath = pathOf(item.href);
    const onPath = path === itemPath || path.startsWith(`${itemPath}/`);
    if (!onPath) continue;
    const itemQuery = queryOf(item.href);
    const itemTab = itemQuery.get("tab");
    const itemSettings = itemQuery.get("settings");
    const itemFocus = itemQuery.get("focus");
    const tabMatches = itemTab === null ? currentTab === null || currentTab === "profile" : currentTab === itemTab;
    const settingsMatches = itemSettings === null || currentSettings === itemSettings;
    if (!tabMatches || !settingsMatches) continue;
    // Your AI key and Team AI keys are one page. Owners land on the team row unless they
    // opened focus=yours. A member has no team row, so the personal row stays current.
    const teamCoversPath = items.some(
      (other) => other.scope === "team" && !other.href.includes("#") && pathOf(other.href) === itemPath,
    );
    if (itemFocus === "yours" && currentFocus !== "yours" && teamCoversPath) continue;
    if (currentFocus === "yours" && itemFocus !== "yours" && itemPath === "/team/ai-keys") continue;
    // On a page both groups list, the team's row is the section for whoever sees it.
    if (itemPath.length > bestScore || (itemPath.length === bestScore && item.scope === "team" && best?.scope === "personal")) {
      bestScore = itemPath.length;
      best = item;
    }
  }
  if (best) return best.id;
  for (const [alias, id] of Object.entries(SETTINGS_PATH_ALIASES)) {
    if ((path === alias || path.startsWith(`${alias}/`)) && items.some((item) => item.id === id)) return id;
  }
  return null;
}

/** The section a settings page shows ("Security", "Members and invites" …), for its title. */
export function settingsSectionLabel(pathname: string, search?: string | null, role?: string | null): string | null {
  const path = pathOf(pathname);
  if (path === SETTINGS_HREF) return "Settings";
  const items = role === undefined ? SETTINGS_NAV : visibleSettingsNav(role);
  const id = activeSettingsId(items, pathname, search);
  return SETTINGS_NAV.find((item) => item.id === id)?.label ?? null;
}

/** "Settings › Security": the one breadcrumb every settings page carries. */
export function settingsBreadcrumb(section: string): string {
  return `Settings › ${section}`;
}
