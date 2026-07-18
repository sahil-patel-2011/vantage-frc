// Outreach Calendar domain types. Pure data shapes — no I/O, no framework imports.
// This is the forward-looking PLANNING surface (events scheduled with projected impact
// metrics), distinct from `lib/impact` which logs outreach ACTIVITY that already happened.

export type OutreachCategory =
  | "stem_demo"
  | "mentoring"
  | "community_event"
  | "fundraising"
  | "media"
  | "other";

export type OutreachAudience =
  | "k12"
  | "college"
  | "public"
  | "industry"
  | "other_teams"
  | "internal"
  | "other";

export type OutreachStatus = "planned" | "confirmed" | "completed" | "canceled";

export type OutreachEvent = {
  id: string;
  title: string;
  category: OutreachCategory;
  /** ISO date (YYYY-MM-DD) the event is scheduled for. */
  scheduledOn: string;
  status: OutreachStatus;
  audience: OutreachAudience;
  /** Projected volunteer hours for this event. */
  projectedHours: number;
  /** Projected number of people reached by this event. */
  projectedPeopleReached: number;
  location: string | null;
  notes: string | null;
  seasonYear: number;
};

export type OutreachCalendarSummary = {
  totalEvents: number;
  plannedEvents: number;
  confirmedEvents: number;
  completedEvents: number;
  canceledEvents: number;
  totalProjectedHours: number;
  totalProjectedPeopleReached: number;
  completedProjectedHours: number;
  completedProjectedPeopleReached: number;
  byCategory: Array<{
    category: OutreachCategory;
    events: number;
    projectedHours: number;
    projectedPeopleReached: number;
  }>;
  byMonth: Array<{ month: string; events: number; projectedHours: number; projectedPeopleReached: number }>;
  /** 0..1 signal blending planned volume with season cadence — never fabricated, zero when empty. */
  projectedImpactScore: number;
};
