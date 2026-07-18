/** Org-scoped evidence pulled into grant drafts — never other teams. */

export type GrantSeasonGoal = {
  title: string;
  category: string;
  currentValue: number;
  targetValue: number;
  unit: string | null;
  progress: number;
};

export type GrantOrgEvidence = {
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  city: string | null;
  stateProv: string | null;
  description: string | null;
  location: string | null;
  seasonYear: number;
  impact: { activities: number; hours: number; peopleReached: number };
  communityHours: number;
  seasonGoals: GrantSeasonGoal[];
  awards: Array<{
    awardName: string;
    eventName: string | null;
    seasonYear: number;
    sourceUrl: string | null;
  }>;
};

export type GrantProvenanceItem = {
  label: string;
  value: string;
  source: string;
  kind: "impact" | "award" | "org" | "goal";
};
