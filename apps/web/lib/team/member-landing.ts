/**
 * What the signed-in landing page (/welcome) shows a member: the sections they can open, a few
 * shortcuts inside each, and the words for their extra powers. It reads the same rules the menus
 * and pages use (hub access rows, sponsor gate, manager-only tabs), so a tile here is never a door
 * that opens onto "you don't have access". Pure; safe for client bundles.
 */

import { CAPABILITY_LABELS } from "../capabilities/org-capabilities";
import {
  clientCanAccessHub,
  filterSponsorTabs,
  filterTabsByHubAccess,
  type ClientHubAccessRow,
} from "../nav/hub-access-filter";
import { hubHref, hubTabsForMember, NAV_HUBS, type ProductHubDef } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { PROFILE_CAPABILITIES } from "./role-profile-copy";

export type LandingShortcut = { label: string; href: string };

export type LandingSection = {
  id: ProductHubDef["id"];
  label: string;
  description: string;
  href: string;
  /** True when only some pages in this section are open to the person. */
  limited: boolean;
  shortcuts: LandingShortcut[];
};

const SHORTCUTS_PER_SECTION = 4;

export function canManageTeam(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function landingSections(input: {
  orgId: string;
  role: string;
  hubAccess: ClientHubAccessRow[];
  sponsorsAllowed: boolean | null;
}): LandingSection[] {
  const rows = canManageTeam(input.role) ? [] : input.hubAccess;
  return NAV_HUBS.filter((hub) => clientCanAccessHub(rows, hub.id)).flatMap((hub) => {
    const open = hubTabsForMember(
      filterSponsorTabs(filterTabsByHubAccess(hub.tabs, rows, hub.id), input.sponsorsAllowed),
      canManageTeam(input.role),
    );
    // Workbenches first; someone limited to inner tools gets those instead.
    const workbenches = open.filter((tab) => !tab.group);
    const tabs = workbenches.length ? workbenches : open;
    if (!tabs.length) return [];
    const limited = Boolean(rows.find((row) => row.hubId === hub.id)?.allowedTabIds.length);
    const shortcuts = tabs
      .slice(0, SHORTCUTS_PER_SECTION)
      .map((tab) => ({ label: tab.label, href: hubHref(hub.href, tab.id, input.orgId) }));
    return [
      {
        id: hub.id,
        label: hub.label,
        description: hub.description,
        href: limited ? shortcuts[0]!.href : withOrgHref(hub.href, input.orgId),
        limited,
        shortcuts,
      },
    ];
  });
}

/** The sections a person could be given; the landing page counts against it. */
export const LANDING_SECTION_TOTAL = NAV_HUBS.length;

/** "Every section", "2 of 4", or "4 of 4, some with only certain pages". */
export function sectionsSummary(sections: readonly LandingSection[]): string {
  const limited = sections.some((section) => section.limited);
  if (sections.length === LANDING_SECTION_TOTAL && !limited) return "Every section";
  const count = `${sections.length} of ${LANDING_SECTION_TOTAL}`;
  return limited ? `${count}, some with only certain pages` : count;
}

const POWER_LABELS: Record<string, string> = {
  ...Object.fromEntries(PROFILE_CAPABILITIES.map((power) => [power.id, power.label])),
  ...CAPABILITY_LABELS,
};

/** "Scouting lead", "Manage money"… in a steady order; unknown ids are left out. */
export function powerLabels(capabilities: readonly string[]): string[] {
  const known = Object.keys(POWER_LABELS);
  return [...new Set(capabilities)]
    .filter((id) => known.includes(id))
    .sort((a, b) => known.indexOf(a) - known.indexOf(b))
    .map((id) => POWER_LABELS[id]!);
}

/** "Good morning" by the server's clock is wrong for half the country; keep it neutral. */
export function greetingFor(firstName: string | null | undefined): string {
  const name = firstName?.trim();
  return name ? `Welcome back, ${name}` : "Welcome back";
}
