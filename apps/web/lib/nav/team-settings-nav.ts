/**
 * The team settings pages, in one order, for one chip row on each of them.
 *
 * Every settings page had its own navigation: Team admin showed five chips, Team security
 * three different ones, AI keys its own tabs, Connectors none, and the breadcrumbs said
 * "Team / Admin", "Settings / Team security" and "AI / AI keys". An owner could not tell they
 * were one set of pages. Each label is the page's own title, so chip, breadcrumb and heading
 * agree. Pure data, safe for client bundles.
 */

import { settingsBreadcrumb } from "./settings-nav";

export type TeamSettingsPageId = "people" | "profile" | "security" | "ai" | "connectors" | "chat" | "data";

export type TeamSettingsPage = { id: TeamSettingsPageId; label: string; href: string };

export const TEAM_SETTINGS_PAGES: readonly TeamSettingsPage[] = [
  { id: "people", label: "Members and invites", href: "/team/admin" },
  { id: "profile", label: "Team profile", href: "/team/admin/profile" },
  { id: "security", label: "Team security", href: "/team/security" },
  { id: "ai", label: "AI keys and credit", href: "/team/ai-keys" },
  { id: "connectors", label: "Connectors", href: "/connectors" },
  { id: "chat", label: "Chat safety", href: "/messages/moderation" },
  { id: "data", label: "Team data and export", href: "/team/data" },
];

/** "Settings › AI keys and credit": the same first word on every settings page. */
export function teamSettingsBreadcrumb(id: TeamSettingsPageId): string {
  const page = TEAM_SETTINGS_PAGES.find((row) => row.id === id);
  return settingsBreadcrumb(page?.label ?? "");
}
