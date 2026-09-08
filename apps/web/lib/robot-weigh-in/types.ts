// Robot weigh-in domain types. Pure data shapes — no I/O, no framework imports.
// Tracks the recorded weigh-in ACTIVITY (date, weight, station) and its trend against the
// competition weight limit across the build season — evidence for readiness, not fabrication.

export type RobotWeighInStation = "shop" | "event_inspection" | "practice_field" | "other";

/**
 * Where the reading came from. `weigh_in` rows are typed into this desk;
 * `inspection` rows are the same robot on the same scale, logged from Inspection
 * (`robot_weights`), mirrored here read-only so one weigh-in is not invisible to
 * the other page. Inspection rows are edited and deleted where they were written.
 */
export type RobotWeighInEntrySource = "weigh_in" | "inspection";

export type RobotWeighInEntry = {
  id: string;
  weighedOn: string;
  weightLbs: number;
  weightLimitLbs: number;
  source: RobotWeighInEntrySource;
  /** Null on mirrored inspection rows: that log records a config string, not a station. */
  station: RobotWeighInStation | null;
  /** Null on mirrored inspection rows — never guessed from the config text. */
  bumpersOn: boolean | null;
  batteryOn: boolean | null;
  /** The mirrored log's free-text config ("with bumpers and battery"), when it has one. */
  configLabel: string | null;
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
