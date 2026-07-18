// Robot weigh-in domain types. Pure data shapes — no I/O, no framework imports.
// Tracks the recorded weigh-in ACTIVITY (date, weight, station) and its trend against the
// competition weight limit across the build season — evidence for readiness, not fabrication.

export type RobotWeighInStation = "shop" | "event_inspection" | "practice_field" | "other";

export type RobotWeighInEntry = {
  id: string;
  weighedOn: string;
  weightLbs: number;
  weightLimitLbs: number;
  station: RobotWeighInStation;
  bumpersOn: boolean;
  batteryOn: boolean;
  seasonYear: number;
  notes: string | null;
};

export type RobotWeighInTrendPoint = {
  weighedOn: string;
  weightLbs: number;
  marginLbs: number;
};

export type RobotWeighInSummary = {
  totalEntries: number;
  latestWeightLbs: number | null;
  latestWeightLimitLbs: number | null;
  latestMarginLbs: number | null;
  minWeightLbs: number | null;
  maxWeightLbs: number | null;
  overLimitCount: number;
  trend: RobotWeighInTrendPoint[];
};
