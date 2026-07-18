// Pure roles/coverage rollups. Deterministic given its input.

import type { RolesSummary, Subteam, TeamRole } from "./types";

const SUBTEAM_ORDER: Subteam[] = [
  "mechanical",
  "electrical",
  "programming",
  "cad",
  "controls",
  "business",
  "drive_team",
  "scouting",
  "media",
  "safety",
  "other",
];

const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function subteamLabel(subteam: Subteam): string {
  const labels: Record<Subteam, string> = {
    mechanical: "Mechanical",
    electrical: "Electrical",
    programming: "Programming",
    cad: "CAD",
    controls: "Controls",
    business: "Business",
    drive_team: "Drive team",
    scouting: "Scouting",
    media: "Media",
    safety: "Safety",
    other: "Other",
  };
  return labels[subteam];
}

export function isFilled(role: TeamRole): boolean {
  return Boolean(role.holderName && role.holderName.trim().length > 0);
}

export function summarizeRoles(roles: TeamRole[]): RolesSummary {
  const filled = roles.filter(isFilled);
  const leads = roles.filter((r) => r.isLead);

  const subMap = new Map<Subteam, { total: number; filled: number }>();
  for (const role of roles) {
    const entry = subMap.get(role.subteam) ?? { total: 0, filled: 0 };
    entry.total += 1;
    if (isFilled(role)) entry.filled += 1;
    subMap.set(role.subteam, entry);
  }
  const bySubteam = [...subMap.entries()]
    .map(([subteam, value]) => ({ subteam, total: value.total, filled: value.filled }))
    .sort(
      (a, b) => SUBTEAM_ORDER.indexOf(a.subteam) - SUBTEAM_ORDER.indexOf(b.subteam) || a.subteam.localeCompare(b.subteam),
    );

  const openRoles = roles
    .filter((r) => !isFilled(r))
    .sort(
      (a, b) =>
        Number(b.isLead) - Number(a.isLead) ||
        SUBTEAM_ORDER.indexOf(a.subteam) - SUBTEAM_ORDER.indexOf(b.subteam) ||
        a.title.localeCompare(b.title),
    );

  return {
    total: roles.length,
    filled: filled.length,
    unfilled: roles.length - filled.length,
    coverage: roles.length > 0 ? round(filled.length / roles.length) : 0,
    leadsTotal: leads.length,
    leadsFilled: leads.filter(isFilled).length,
    bySubteam,
    openRoles,
  };
}

/** Display sort: leads first, then subteam order, then title. */
export function sortRoles(roles: TeamRole[]): TeamRole[] {
  return [...roles].sort(
    (a, b) =>
      Number(b.isLead) - Number(a.isLead) ||
      SUBTEAM_ORDER.indexOf(a.subteam) - SUBTEAM_ORDER.indexOf(b.subteam) ||
      a.title.localeCompare(b.title),
  );
}
