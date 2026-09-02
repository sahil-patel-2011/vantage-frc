// Outreach Calendar rollups. Pure aggregation over planned events — deterministic
// given its input; upcoming-event ordering takes an explicit reference date, no clock.

export * from "./types";

import type { ImpactCategory } from "../impact/types";
import type { OutreachAudience, OutreachCalendarSummary, OutreachCategory, OutreachEvent } from "./types";

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Calendar category -> impact_activities category (0038 CHECK list). Fundraising has no
 * impact equivalent and lands in 'other' rather than being dressed up as community outreach.
 */
export const OUTREACH_TO_IMPACT_CATEGORY: Record<OutreachCategory, ImpactCategory> = {
  stem_demo: "stem_demo",
  mentoring: "mentoring",
  community_event: "community_event",
  fundraising: "other",
  media: "media",
  other: "other",
};

export type ImpactActivityDraft = {
  title: string;
  category: ImpactCategory;
  occurredOn: string;
  durationMinutes: number;
  participantCount: number;
  peopleReached: number;
  audience: OutreachAudience;
  location: string | null;
  description: string | null;
  seasonYear: number;
};

/**
 * Convert a completed calendar event into the impact_activities row that substantiates the
 * Impact award. Projections become the logged numbers unless the team supplies actuals —
 * and an actual of 0 is honored, never "corrected" back to the projection.
 */
export function outreachEventToImpactActivity(
  event: OutreachEvent,
  actuals: { actualHours?: number | null; actualPeopleReached?: number | null; participantCount?: number | null } = {},
): ImpactActivityDraft {
  const hours = actuals.actualHours != null && Number.isFinite(actuals.actualHours) ? actuals.actualHours : event.projectedHours;
  const people =
    actuals.actualPeopleReached != null && Number.isFinite(actuals.actualPeopleReached)
      ? actuals.actualPeopleReached
      : event.projectedPeopleReached;
  const participants =
    actuals.participantCount != null && Number.isFinite(actuals.participantCount) ? actuals.participantCount : 0;
  return {
    title: event.title,
    category: OUTREACH_TO_IMPACT_CATEGORY[event.category] ?? "other",
    occurredOn: event.scheduledOn,
    durationMinutes: Math.max(0, Math.round(hours * 60)),
    participantCount: Math.max(0, Math.round(participants)),
    peopleReached: Math.max(0, Math.round(people)),
    audience: event.audience,
    location: event.location,
    description: event.notes,
    seasonYear: event.seasonYear,
  };
}

export type OutreachTargets = {
  /** Projected hours across the season that reads as a full-strength plan (default 80). */
  hoursTarget: number;
  /** Projected people reached across the season that reads as full-strength (default 750). */
  peopleTarget: number;
  /** Distinct months with a planned event that reads as "sustained" (default 6). */
  sustainedMonths: number;
};

export const DEFAULT_TARGETS: OutreachTargets = {
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
 * Aggregate planned outreach events into totals + breakdowns + a 0..1 projected-impact
 * signal. The signal blends planned volume (hours, people reached) with sustained cadence
 * (distinct months with a planned event) so a single big event doesn't read as a full plan.
 */
export function summarizeOutreachCalendar(
  events: OutreachEvent[],
  targets: Partial<OutreachTargets> = {},
): OutreachCalendarSummary {
  const t = { ...DEFAULT_TARGETS, ...targets };

  let totalProjectedHours = 0;
  let totalProjectedPeopleReached = 0;
  let completedProjectedHours = 0;
  let completedProjectedPeopleReached = 0;
  let plannedEvents = 0;
  let confirmedEvents = 0;
  let completedEvents = 0;
  let canceledEvents = 0;

  const categoryMap = new Map<OutreachCategory, { events: number; hours: number; peopleReached: number }>();
  const monthMap = new Map<string, { events: number; hours: number; peopleReached: number }>();

  for (const event of events) {
    const hours = Math.max(0, event.projectedHours || 0);
    const people = Math.max(0, event.projectedPeopleReached || 0);

    if (event.status === "canceled") {
      canceledEvents += 1;
      continue;
    }

    if (event.status === "planned") plannedEvents += 1;
    else if (event.status === "confirmed") confirmedEvents += 1;
    else if (event.status === "completed") completedEvents += 1;

    totalProjectedHours += hours;
    totalProjectedPeopleReached += people;
    if (event.status === "completed") {
      completedProjectedHours += hours;
      completedProjectedPeopleReached += people;
    }

    const cat = categoryMap.get(event.category) ?? { events: 0, hours: 0, peopleReached: 0 };
    cat.events += 1;
    cat.hours += hours;
    cat.peopleReached += people;
    categoryMap.set(event.category, cat);

    const month = monthOf(event.scheduledOn);
    if (month) {
      const bucket = monthMap.get(month) ?? { events: 0, hours: 0, peopleReached: 0 };
      bucket.events += 1;
      bucket.hours += hours;
      bucket.peopleReached += people;
      monthMap.set(month, bucket);
    }
  }

  const byCategory = [...categoryMap.entries()]
    .map(([category, value]) => ({
      category,
      events: value.events,
      projectedHours: round1(value.hours),
      projectedPeopleReached: value.peopleReached,
    }))
    .sort((a, b) => b.projectedHours - a.projectedHours || b.events - a.events);

  const byMonth = [...monthMap.entries()]
    .map(([month, value]) => ({
      month,
      events: value.events,
      projectedHours: round1(value.hours),
      projectedPeopleReached: value.peopleReached,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const activeMonths = monthMap.size;
  const volume = clamp01(
    0.5 * clamp01(totalProjectedHours / t.hoursTarget) + 0.5 * clamp01(totalProjectedPeopleReached / t.peopleTarget),
  );
  const cadence = clamp01(activeMonths / t.sustainedMonths);
  const nonCanceled = events.length - canceledEvents;
  const projectedImpactScore = nonCanceled === 0 ? 0 : round1(clamp01(0.7 * volume + 0.3 * cadence));

  return {
    totalEvents: nonCanceled,
    plannedEvents,
    confirmedEvents,
    completedEvents,
    canceledEvents,
    totalProjectedHours: round1(totalProjectedHours),
    totalProjectedPeopleReached,
    completedProjectedHours: round1(completedProjectedHours),
    completedProjectedPeopleReached,
    byCategory,
    byMonth,
    projectedImpactScore,
  };
}

/**
 * Non-canceled, non-completed events scheduled on/after the reference date, soonest first.
 */
export function upcomingOutreachEvents(events: OutreachEvent[], referenceDate: string): OutreachEvent[] {
  return events
    .filter((event) => event.status !== "canceled" && event.status !== "completed" && event.scheduledOn >= referenceDate)
    .sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn));
}

export function outreachCategoryLabel(category: OutreachCategory): string {
  const labels: Record<OutreachCategory, string> = {
    stem_demo: "STEM demo / workshop",
    mentoring: "Mentoring",
    community_event: "Community event",
    fundraising: "Fundraising",
    media: "Media / press",
    other: "Other",
  };
  return labels[category];
}

export function outreachAudienceLabel(audience: OutreachAudience): string {
  const labels: Record<OutreachAudience, string> = {
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

export function outreachStatusLabel(status: OutreachEvent["status"]): string {
  const labels: Record<OutreachEvent["status"], string> = {
    planned: "Planned",
    confirmed: "Confirmed",
    completed: "Completed",
    canceled: "Canceled",
  };
  return labels[status];
}
