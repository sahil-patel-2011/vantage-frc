// Mentor Hours & Engagement rollups. Pure aggregation over logged entries — deterministic
// given its input (recency uses an explicit date sort, no clock). This never fabricates a
// score: an empty log yields 0 across the board.

export * from "./types";

import type {
  MentorHoursCategory,
  MentorHoursEngagement,
  MentorHoursEntry,
  MentorHoursRole,
  MentorHoursSummary,
  MentorHoursTier,
} from "./types";

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export type MentorHoursTargets = {
  /** Hours of logged mentor time that reads as a full-strength season (default 200). */
  hoursTarget: number;
  /** Distinct months with activity that reads as "sustained" (default 6). */
  sustainedMonths: number;
  /** Distinct mentors engaged that reads as a broad mentor bench (default 4). */
  mentorTarget: number;
  /** Distinct mentor roles engaged that reads as a diverse bench (default 3). */
  roleTarget: number;
};

export const DEFAULT_TARGETS: MentorHoursTargets = {
  hoursTarget: 200,
  sustainedMonths: 6,
  mentorTarget: 4,
  roleTarget: 3,
};

function monthOf(iso: string): string | null {
  if (typeof iso !== "string" || iso.length < 7) return null;
  const month = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

/**
 * Aggregate mentor-hours entries into totals + breakdowns + a 0..1 engagement signal.
 * The signal blends volume (hours) with sustained cadence (distinct active months), so
 * one big block of hours does not read the same as season-long mentor engagement.
 */
export function summarizeMentorHours(
  entries: MentorHoursEntry[],
  targets: Partial<MentorHoursTargets> = {},
): MentorHoursSummary {
  const t = { ...DEFAULT_TARGETS, ...targets };

  let totalMinutes = 0;
  const categoryMap = new Map<MentorHoursCategory, { entries: number; minutes: number }>();
  const roleMap = new Map<MentorHoursRole, { entries: number; minutes: number }>();
  const mentorMap = new Map<string, { entries: number; minutes: number }>();
  const monthMap = new Map<string, { entries: number; minutes: number }>();

  for (const entry of entries) {
    const minutes = Math.max(0, entry.durationMinutes || 0);
    totalMinutes += minutes;

    const cat = categoryMap.get(entry.category) ?? { entries: 0, minutes: 0 };
    cat.entries += 1;
    cat.minutes += minutes;
    categoryMap.set(entry.category, cat);

    const role = roleMap.get(entry.role) ?? { entries: 0, minutes: 0 };
    role.entries += 1;
    role.minutes += minutes;
    roleMap.set(entry.role, role);

    const mentorKey = entry.mentorName.trim().toLowerCase();
    const mentor = mentorMap.get(mentorKey) ?? { entries: 0, minutes: 0 };
    mentor.entries += 1;
    mentor.minutes += minutes;
    mentorMap.set(mentorKey, mentor);

    const month = monthOf(entry.occurredOn);
    if (month) {
      const bucket = monthMap.get(month) ?? { entries: 0, minutes: 0 };
      bucket.entries += 1;
      bucket.minutes += minutes;
      monthMap.set(month, bucket);
    }
  }

  const byCategory = [...categoryMap.entries()]
    .map(([category, value]) => ({ category, entries: value.entries, hours: round1(value.minutes / 60) }))
    .sort((a, b) => b.hours - a.hours || b.entries - a.entries);

  const byRole = [...roleMap.entries()]
    .map(([role, value]) => ({ role, entries: value.entries, hours: round1(value.minutes / 60) }))
    .sort((a, b) => b.hours - a.hours || b.entries - a.entries);

  const nameByKey = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.mentorName.trim().toLowerCase();
    if (!nameByKey.has(key)) nameByKey.set(key, entry.mentorName.trim());
  }
  const byMentor = [...mentorMap.entries()]
    .map(([key, value]) => ({
      mentorName: nameByKey.get(key) ?? key,
      entries: value.entries,
      hours: round1(value.minutes / 60),
    }))
    .sort((a, b) => b.hours - a.hours || b.entries - a.entries);

  const byMonth = [...monthMap.entries()]
    .map(([month, value]) => ({ month, entries: value.entries, hours: round1(value.minutes / 60) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const recent = [...entries].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)).slice(0, 8);

  const totalHours = round1(totalMinutes / 60);
  const activeMonths = monthMap.size;
  const volume = clamp01(totalHours / t.hoursTarget);
  const cadence = clamp01(activeMonths / t.sustainedMonths);
  const engagementSignal = round1(clamp01(0.7 * volume + 0.3 * cadence));

  return {
    totalEntries: entries.length,
    totalMinutes,
    totalHours,
    uniqueMentors: mentorMap.size,
    byCategory,
    byRole,
    byMentor,
    byMonth,
    recent,
    engagementSignal,
  };
}

function tierFor(score: number): MentorHoursTier {
  if (score >= 0.66) return "strong";
  if (score >= 0.33) return "developing";
  return "emerging";
}

/**
 * Grant-readiness engagement score computed from the logged entries themselves. Scores the
 * dimensions grant reviewers weigh for mentor engagement narratives — total volume, sustained
 * cadence, and breadth of the mentor bench (people and roles) — and turns the weakest
 * dimensions into concrete next steps.
 */
export function computeMentorEngagement(
  summary: MentorHoursSummary,
  targets: Partial<MentorHoursTargets> = {},
): MentorHoursEngagement {
  const t = { ...DEFAULT_TARGETS, ...targets };

  const volume = clamp01(summary.totalHours / t.hoursTarget);
  const monthsActive = summary.byMonth.length;
  const cadence = clamp01(monthsActive / t.sustainedMonths);
  const mentorBreadth = clamp01(summary.uniqueMentors / t.mentorTarget);
  const roleBreadth = clamp01(summary.byRole.length / t.roleTarget);

  const components = {
    volume: round(volume),
    cadence: round(cadence),
    mentorBreadth: round(mentorBreadth),
    roleBreadth: round(roleBreadth),
  };

  const score = round(0.4 * volume + 0.3 * cadence + 0.2 * mentorBreadth + 0.1 * roleBreadth);

  return {
    score,
    tier: tierFor(score),
    components,
    monthsActive,
    mentorsEngaged: summary.uniqueMentors,
    recommendations: buildRecommendations(summary, components, monthsActive, t),
  };
}

function buildRecommendations(
  summary: MentorHoursSummary,
  components: MentorHoursEngagement["components"],
  monthsActive: number,
  t: MentorHoursTargets,
): string[] {
  if (summary.totalEntries === 0) {
    return ["Log your first mentor-hours entry — build sessions, strategy meetings, and outreach all count."];
  }
  const out: string[] = [];
  if (components.cadence < 0.5) {
    out.push(
      `Spread mentor time across more of the season — active in ${monthsActive} of ${t.sustainedMonths} target months. Sustained engagement reads stronger than a few heavy weeks.`,
    );
  }
  if (components.volume < 0.5) {
    out.push(`Log more hours toward ${t.hoursTarget}h — ${summary.totalHours}h recorded.`);
  }
  if (components.mentorBreadth < 0.5) {
    out.push(
      `Engage more mentors — ${summary.uniqueMentors} of ${t.mentorTarget} target mentors logged. Grant reviewers look for a broad, sustainable mentor bench.`,
    );
  }
  if (components.roleBreadth < 0.5) {
    out.push("Diversify mentor roles — professional mentors, alumni, and parent volunteers all strengthen the narrative.");
  }
  if (out.length === 0) {
    out.push("Strong, well-rounded mentor record — keep it current for grant and award submissions.");
  }
  return out;
}

export function mentorHoursCategoryLabel(category: MentorHoursCategory): string {
  const labels: Record<MentorHoursCategory, string> = {
    build: "Build session",
    strategy: "Strategy / planning",
    programming: "Programming",
    outreach: "Outreach support",
    administration: "Administration",
    competition: "Competition support",
    training: "Training / mentoring",
    other: "Other",
  };
  return labels[category];
}

export function mentorHoursRoleLabel(role: MentorHoursRole): string {
  const labels: Record<MentorHoursRole, string> = {
    mentor: "Mentor",
    professional_mentor: "Professional mentor",
    alumni_mentor: "Alumni mentor",
    parent_volunteer: "Parent volunteer",
    other: "Other",
  };
  return labels[role];
}
