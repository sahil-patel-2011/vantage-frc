// Community Impact domain types. Pure data shapes — no I/O, no framework imports.
// Distinct from the fundraising "sponsor outreach" surface: this tracks the community /
// STEM outreach ACTIVITIES that substantiate the Impact & Engineering Inspiration awards
// (hours contributed, people reached, audiences served) — the evidence trail, not the essay.

export type ImpactCategory =
  | "stem_demo"
  | "mentoring"
  | "community_event"
  | "competition"
  | "media"
  | "sustainability"
  | "other";

export type ImpactAudience =
  | "k12"
  | "college"
  | "public"
  | "industry"
  | "other_teams"
  | "internal"
  | "other";

/** Awards whose judging is substantiated by a sustained community-impact record. */
export type ImpactAwardTag = "impact" | "engineering_inspiration" | "rookie_all_star";

export type ImpactActivity = {
  id: string;
  title: string;
  category: ImpactCategory;
  /** ISO date (YYYY-MM-DD). */
  occurredOn: string;
  durationMinutes: number;
  /** Team members who took part. */
  participantCount: number;
  /** People reached in the community. */
  peopleReached: number;
  audience: ImpactAudience;
  location: string | null;
  seasonYear: number;
  description: string | null;
  /** Award narratives this activity is offered as evidence for. */
  evidenceAwards: ImpactAwardTag[];
};

export type ImpactSummary = {
  totalEvents: number;
  totalMinutes: number;
  totalHours: number;
  totalPeopleReached: number;
  totalParticipants: number;
  byCategory: Array<{
    category: ImpactCategory;
    events: number;
    hours: number;
    peopleReached: number;
  }>;
  byAudience: Array<{ audience: ImpactAudience; events: number; peopleReached: number }>;
  byMonth: Array<{ month: string; events: number; hours: number; peopleReached: number }>;
  recent: ImpactActivity[];
  /** 0..1 signal blending volume (hours + reach) with sustained cadence. */
  impactSignal: number;
};

export type ImpactTier = "emerging" | "developing" | "strong";

export type ImpactReadiness = {
  /** 0..1 overall Impact-award evidence readiness. */
  score: number;
  tier: ImpactTier;
  components: {
    volume: number;
    reach: number;
    cadence: number;
    audienceBreadth: number;
    youthFocus: number;
  };
  monthsActive: number;
  audiencesReached: number;
  recommendations: string[];
};
