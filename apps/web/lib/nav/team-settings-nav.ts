/**
 * The team settings pages, in one order, for one chip row on each of them.
 *
 * Every settings page had its own navigation: Team admin showed five chips, Team security
 * three different ones, AI keys its own tabs, Connectors none, and the breadcrumbs said
 * "Team / Admin", "Settings / Team security" and "AI / AI keys". An owner could not tell they
 * were one set of pages. Pure data, safe for client bundles.
 */

export type TeamSettingsPageId = "people" | "profile" | "security" | "ai" | "connectors" | "chat" | "data";

export type TeamSettingsPage = { id: TeamSettingsPageId; label: string; href: string };

export const TEAM_SETTINGS_PAGES: readonly TeamSettingsPage[] = [
  { id: "people", label: "People & invites", href: "/team/admin" },
  { id: "profile", label: "Team profile", href: "/team/admin/profile" },
  { id: "security", label: "Sign-in & security", href: "/team/security" },
  { id: "ai", label: "AI keys", href: "/team/ai-keys" },
  { id: "connectors", label: "Connectors", href: "/connectors" },
  { id: "chat", label: "Chat moderation", href: "/messages/moderation" },
  { id: "data", label: "Team data", href: "/team/data" },
];

/** "Team settings / AI keys": the same first word on every one of these pages. */
export function teamSettingsBreadcrumb(id: TeamSettingsPageId): string {
  const page = TEAM_SETTINGS_PAGES.find((row) => row.id === id);
  return `Team settings / ${page?.label ?? ""}`.trim();
}
