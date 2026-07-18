// Alumni network rollups. Pure aggregation over profiles + mentor slots — deterministic
// given its input, no I/O.

export * from "./types";

import type { AlumniProfile, AlumniStatus, AlumniSummary, MentorSlot, MentorSlotStatus } from "./types";

function decadeOf(year: number | null): string | null {
  if (year == null || !Number.isFinite(year)) return null;
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}

/**
 * Aggregate alumni profiles + mentor slots into directory totals and breakdowns.
 * No fabricated numbers — every count is derived directly from logged rows.
 */
export function summarizeAlumniNetwork(profiles: AlumniProfile[], slots: MentorSlot[]): AlumniSummary {
  const focusAreaMap = new Map<string, number>();
  const decadeMap = new Map<string, number>();
  let activeAlumni = 0;
  let mentorsAvailable = 0;

  for (const profile of profiles) {
    if (profile.status === "active") activeAlumni += 1;
    if (profile.mentorAvailable) mentorsAvailable += 1;
    for (const area of profile.mentorFocusAreas) {
      focusAreaMap.set(area, (focusAreaMap.get(area) ?? 0) + 1);
    }
    const decade = decadeOf(profile.graduationYear);
    if (decade) decadeMap.set(decade, (decadeMap.get(decade) ?? 0) + 1);
  }

  const openMentorSlots = slots.filter((slot) => slot.status === "open").length;

  const byFocusArea = [...focusAreaMap.entries()]
    .map(([focusArea, count]) => ({ focusArea, count }))
    .sort((a, b) => b.count - a.count || a.focusArea.localeCompare(b.focusArea));

  const byDecade = [...decadeMap.entries()]
    .map(([decade, count]) => ({ decade, count }))
    .sort((a, b) => a.decade.localeCompare(b.decade));

  return {
    totalAlumni: profiles.length,
    activeAlumni,
    mentorsAvailable,
    openMentorSlots,
    byFocusArea,
    byDecade,
  };
}

export function alumniStatusLabel(status: AlumniStatus): string {
  const labels: Record<AlumniStatus, string> = {
    active: "Active",
    inactive: "Inactive",
  };
  return labels[status];
}

export function mentorSlotStatusLabel(status: MentorSlotStatus): string {
  const labels: Record<MentorSlotStatus, string> = {
    open: "Open",
    booked: "Booked",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[status];
}
