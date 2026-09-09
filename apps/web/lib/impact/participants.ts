// Per-person outreach totals, from named participation.
//
// The question this answers is the one every team asks in March: "how many
// outreach hours does each student have?" The only honest source for that is
// rows where someone was named on an activity with their own minutes. An
// activity's headline duration is not credited to anyone automatically — a
// student who came for the last twenty minutes did not do the four-hour event.

import type { ImpactActivity, PersonOutreachTotal } from "./types";

export function summarizePeople(activities: readonly ImpactActivity[]): PersonOutreachTotal[] {
  const byUser = new Map<string, PersonOutreachTotal>();
  for (const activity of activities) {
    for (const p of activity.participants) {
      let row = byUser.get(p.userId);
      if (!row) {
        row = { userId: p.userId, name: p.name, events: 0, minutes: 0, hours: 0, unrecorded: 0 };
        byUser.set(p.userId, row);
      }
      row.events += 1;
      if (p.minutes == null) row.unrecorded += 1;
      else row.minutes += p.minutes;
    }
  }
  const people = [...byUser.values()].map((row) => ({
    ...row,
    hours: Math.round((row.minutes / 60) * 10) / 10,
  }));
  // Most hours first; ties by name so the order is stable between renders.
  people.sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  return people;
}

/**
 * Validate a participant list from a request body. Drops anything that is not
 * a UUID-shaped user id, clamps minutes to a day, and de-duplicates by user so
 * a double-click cannot credit someone twice.
 */
export function normalizeParticipantInput(
  raw: unknown,
): Array<{ userId: string; minutes: number | null; role: string | null }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ userId: string; minutes: number | null; role: string | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const userId = typeof rec.userId === "string" ? rec.userId.trim() : "";
    if (!UUID.test(userId) || seen.has(userId)) continue;
    seen.add(userId);
    let minutes: number | null = null;
    if (rec.minutes !== undefined && rec.minutes !== null && rec.minutes !== "") {
      const n = Number(rec.minutes);
      if (Number.isFinite(n)) minutes = Math.min(24 * 60, Math.max(0, Math.round(n)));
    }
    const role = typeof rec.role === "string" && rec.role.trim() ? rec.role.trim().slice(0, 80) : null;
    out.push({ userId, minutes, role });
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
