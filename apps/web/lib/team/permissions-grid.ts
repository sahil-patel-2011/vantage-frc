/**
 * The rules behind the permissions grid (components/permissions-grid.tsx): one row per person,
 * their access, the sections they can open and their extra powers. Team admin's grid and
 * Platform admin's grid share these, so a change means the same thing on both. Pure; safe for
 * client bundles.
 *
 * Stored shape (unchanged): no hub-access rows means every section; rows mean "only these".
 * A section with page limits (set from the Access window) keeps them while it stays on.
 */

import { CLIENT_HUB_IDS, type ClientHubId } from "../nav/hub-access-filter";

export type GridHubRow = { hubId: string; allowedTabIds: string[] };

export type GridMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
  capabilities: string[];
  hubAccess: GridHubRow[];
};

export type GridDraft = { role: string; capabilities: string[]; open: ClientHubId[] };

export type GridChange = {
  role: string;
  capabilities: string[];
  hubAccess: GridHubRow[];
  changed: { role: boolean; capabilities: boolean; hubAccess: boolean };
};

/** The extra powers the grid shows, with short column names. Ids match ORG_CAPABILITIES. */
export const GRID_POWERS = [
  { id: "manage_scouting", short: "Scouting lead" },
  { id: "manage_members", short: "Invite people" },
  { id: "manage_team_settings", short: "Team settings" },
  { id: "manage_api_keys", short: "AI keys" },
  { id: "manage_billing", short: "AI usage" },
] as const;

const POWER_IDS: readonly string[] = GRID_POWERS.map((power) => power.id);

/** Students and parents get sections and powers; owners and mentors already have everything. */
export function isLimitedRole(role: string): boolean {
  return role === "scout" || role === "viewer";
}

export function draftFor(member: GridMember): GridDraft {
  const rows = member.hubAccess.filter((row) => (CLIENT_HUB_IDS as readonly string[]).includes(row.hubId));
  return {
    role: member.role,
    capabilities: member.capabilities.filter((id) => POWER_IDS.includes(id)).sort(),
    open: rows.length ? CLIENT_HUB_IDS.filter((id) => rows.some((row) => row.hubId === id)) : [...CLIENT_HUB_IDS],
  };
}

/** The pages a section is limited to; empty means every page in it. */
export function pageLimits(member: GridMember, hubId: ClientHubId): string[] {
  return member.hubAccess.find((row) => row.hubId === hubId)?.allowedTabIds ?? [];
}

/** What to store for this draft: [] when every section is open with no page limits. */
export function hubAccessFor(member: GridMember, draft: GridDraft): GridHubRow[] {
  if (!isLimitedRole(draft.role)) return [];
  // A scouting lead always opens every Competition page.
  const lead = draft.capabilities.includes("manage_scouting");
  const open = lead && !draft.open.includes("competition") ? [...draft.open, "competition" as const] : draft.open;
  const rows = CLIENT_HUB_IDS.filter((id) => open.includes(id)).map((hubId) => ({
    hubId,
    allowedTabIds: lead && hubId === "competition" ? [] : pageLimits(member, hubId),
  }));
  const everything = rows.length === CLIENT_HUB_IDS.length && rows.every((row) => row.allowedTabIds.length === 0);
  return everything ? [] : rows;
}

function hubKey(rows: GridHubRow[]): string {
  return JSON.stringify(
    [...rows]
      .map((row) => [row.hubId, [...row.allowedTabIds].sort()] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

/** What changed for one person, or null when the draft matches what is saved. */
export function rowChange(member: GridMember, draft: GridDraft): GridChange | null {
  const limited = isLimitedRole(draft.role);
  const wasLimited = isLimitedRole(member.role);
  const saved = draftFor(member);
  const capabilities = limited ? [...new Set(draft.capabilities)].sort() : [];
  const hubAccess = hubAccessFor(member, draft);
  const changed = {
    role: draft.role !== member.role,
    capabilities: limited && capabilities.join(",") !== (wasLimited ? saved.capabilities : []).join(","),
    hubAccess: limited && hubKey(hubAccess) !== hubKey(wasLimited ? hubAccessFor(member, saved) : []),
  };
  if (!changed.role && !changed.capabilities && !changed.hubAccess) return null;
  return { role: draft.role, capabilities, hubAccess, changed };
}

/** Turn one section on or off. The last open section stays on: nobody is left with nothing. */
export function toggleSection(draft: GridDraft, hubId: ClientHubId): GridDraft {
  if (draft.open.includes(hubId)) {
    if (draft.open.length === 1) return draft;
    return { ...draft, open: draft.open.filter((id) => id !== hubId) };
  }
  return { ...draft, open: CLIENT_HUB_IDS.filter((id) => id === hubId || draft.open.includes(id)) };
}

export function togglePower(draft: GridDraft, powerId: string): GridDraft {
  const capabilities = draft.capabilities.includes(powerId)
    ? draft.capabilities.filter((id) => id !== powerId)
    : [...draft.capabilities, powerId].sort();
  return { ...draft, capabilities };
}

/**
 * A new role. Coming back to Student or Parent from Mentor starts from what they had saved
 * (or everything open with no powers if they were never limited).
 */
export function withRole(member: GridMember, draft: GridDraft, role: string): GridDraft {
  if (isLimitedRole(role) && !isLimitedRole(draft.role)) {
    const base = isLimitedRole(member.role)
      ? draftFor(member)
      : { role, capabilities: [], open: [...CLIENT_HUB_IDS] };
    return { ...base, role };
  }
  return { ...draft, role };
}
