// Community-impact rollups. Pure aggregation over logged activities — deterministic
// given its input (recency uses an explicit date sort, no clock).

import type { ImpactActivity, ImpactAudience, ImpactCategory, ImpactSummary } from "./types";

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export type ImpactTargets = {
  /** Hours of logged impact that reads as a full-strength season (default 80). */
  hoursTarget: number;
  /** People reached that reads as full-strength community impact (default 750). */
  peopleTarget: number;
  /** Distinct months with activity that reads as "sustained" (default 6). */
  sustainedMonths: number;
};

export const DEFAULT_TARGETS: ImpactTargets = {
  hoursTarget: 80,
  peopleTarget: 750,
  sustainedMonths: 6,
};

function monthOf(iso: string): string | null {
  if (typeof iso !== "string" || iso.length < 7) return null;
  const month = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

/**
 * Aggregate impact activities into totals + breakdowns + a 0..1 impact signal.
 * The signal blends volume (hours, people reached) with sustained cadence (distinct
 * active months), so one big event does not read the same as season-long engagement.
 */
export function summarizeImpact(
  activities: ImpactActivity[],
  targets: Partial<ImpactTargets> = {},
): ImpactSummary {
  const t = { ...DEFAULT_TARGETS, ...targets };

  let totalMinutes = 0;
  let totalPeopleReached = 0;
  let totalParticipants = 0;

  const categoryMap = new Map<ImpactCategory, { events: number; minutes: number; peopleReached: number }>();
  const audienceMap = new Map<ImpactAudience, { events: number; peopleReached: number }>();
  const monthMap = new Map<string, { events: number; minutes: number; peopleReached: number }>();

  for (const activity of activities) {
    const minutes = Math.max(0, activity.durationMinutes || 0);
    const people = Math.max(0, activity.peopleReached || 0);
    const participants = Math.max(0, activity.participantCount || 0);
    totalMinutes += minutes;
    totalPeopleReached += people;
    totalParticipants += participants;

    const cat = categoryMap.get(activity.category) ?? { events: 0, minutes: 0, peopleReached: 0 };
    cat.events += 1;
    cat.minutes += minutes;
    cat.peopleReached += people;
    categoryMap.set(activity.category, cat);

    const aud = audienceMap.get(activity.audience) ?? { events: 0, peopleReached: 0 };
    aud.events += 1;
    aud.peopleReached += people;
    audienceMap.set(activity.audience, aud);

    const month = monthOf(activity.occurredOn);
    if (month) {
      const bucket = monthMap.get(month) ?? { events: 0, minutes: 0, peopleReached: 0 };
      bucket.events += 1;
      bucket.minutes += minutes;
      bucket.peopleReached += people;
      monthMap.set(month, bucket);
    }
  }

  const byCategory = [...categoryMap.entries()]
    .map(([category, value]) => ({
      category,
      events: value.events,
      hours: round1(value.minutes / 60),
      peopleReached: value.peopleReached,
    }))
    .sort((a, b) => b.hours - a.hours || b.events - a.events);

  const byAudience = [...audienceMap.entries()]
    .map(([audience, value]) => ({ audience, events: value.events, peopleReached: value.peopleReached }))
    .sort((a, b) => b.peopleReached - a.peopleReached || b.events - a.events);

  const byMonth = [...monthMap.entries()]
    .map(([month, value]) => ({
      month,
      events: value.events,
      hours: round1(value.minutes / 60),
      peopleReached: value.peopleReached,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const recent = [...activities]
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    .slice(0, 8);

  const totalHours = round1(totalMinutes / 60);
  const activeMonths = monthMap.size;
  const volume = clamp01(
    0.5 * clamp01(totalHours / t.hoursTarget) + 0.5 * clamp01(totalPeopleReached / t.peopleTarget),
  );
  const cadence = clamp01(activeMonths / t.sustainedMonths);
  const impactSignal = round1(clamp01(0.7 * volume + 0.3 * cadence));

  return {
    totalEvents: activities.length,
    totalMinutes,
    totalHours,
    totalPeopleReached,
    totalParticipants,
    byCategory,
    byAudience,
    byMonth,
    recent,
    impactSignal,
  };
}

export function impactCategoryLabel(category: ImpactCategory): string {
  const labels: Record<ImpactCategory, string> = {
    stem_demo: "STEM demo / workshop",
    mentoring: "Mentoring",
    community_event: "Community event",
    competition: "Competition outreach",
    media: "Media / press",
    sustainability: "Sustainability",
    other: "Other",
  };
  return labels[category];
}

export function impactAudienceLabel(audience: ImpactAudience): string {
  const labels: Record<ImpactAudience, string> = {
    k12: "K-12 students",
    college: "College / university",
    public: "General public",
    industry: "Industry / sponsors",
    other_teams: "Other FRC teams",
    internal: "Internal team",
    other: "Other",
  };
  return labels[audience];
}
