// FIRST Impact essay generator domain types. Pure data shapes — no I/O, no framework imports.
// The essay is drafted strictly from this org's logged records; every claim in the composed
// text is backed by a citation pointing at a real row (outreach activity, hour log, sponsor,
// or team event) — nothing here is fabricated.

export type ImpactEssayAward = "impact" | "engineering_inspiration";

export type ImpactEssayCitationKind = "outreach_activity" | "hour_log" | "sponsor" | "team_event";

export type ImpactEssayCitation = {
  id: string;
  kind: ImpactEssayCitationKind;
  label: string;
};

export type ImpactEssayOutreachActivity = {
  id: string;
  title: string;
  category: string;
  occurredOn: string;
  peopleReached: number;
  durationMinutes: number;
};

export type ImpactEssayTeamEvent = {
  id: string;
  title: string;
  kind: string;
  occurredOn: string;
  creditHours: number;
};

export type ImpactEssaySponsor = {
  id: string;
  name: string;
  tier: string;
  status: string;
};

export type ImpactEssayGroundedFacts = {
  seasonYear: number;
  outreachActivities: ImpactEssayOutreachActivity[];
  totalOutreachHours: number;
  totalPeopleReached: number;
  buildHours: {
    totalHours: number;
    contributorCount: number;
  };
  sponsors: ImpactEssaySponsor[];
  events: ImpactEssayTeamEvent[];
  /** True when at least one grounded record exists to draft from. */
  hasGroundedData: boolean;
};

export type ImpactEssayDraft = {
  id: string;
  seasonYear: number;
  award: ImpactEssayAward;
  prompt: string;
  essayText: string;
  wordCount: number;
  citations: ImpactEssayCitation[];
  createdAt: string;
};
