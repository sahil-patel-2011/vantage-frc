// Scout shift load balancer domain types. Pure data shapes -- no I/O, no framework imports.
// Auto-generates match-by-match shift rotations across a scout roster, capping how many
// consecutive matches any one scout works so nobody burns out mid-event.

export type ShiftBalancerScout = {
  id: string;
  name: string;
  active: boolean;
};

export type ShiftBalancerAssignment = {
  match: number;
  station: string;
  scoutId: string;
  scoutName: string;
  /** TBA match key when this plan was built from the event schedule. */
  matchKey?: string;
  teamKey?: string;
  teamNumber?: number;
  matchLabel?: string;
  /** TBA predicted/event time when the plan was overlaid on a real schedule. */
  scheduledAt?: string;
  /** Minutes until the next qual when that gap is a natural break (lunch / field downtime). */
  breakAfterMinutes?: number;
};

export type ShiftBalancerPlan = {
  id: string;
  label: string;
  matchCount: number;
  stations: string[];
  maxConsecutiveMatches: number;
  assignments: ShiftBalancerAssignment[];
  createdAt: string;
};

export type ShiftBalancerLoad = {
  scoutId: string;
  scoutName: string;
  shifts: number;
  /** Longest run of consecutive matches this scout worked in the plan. */
  longestStreak: number;
};

export type ShiftBalancerSummary = {
  totalMatches: number;
  totalShifts: number;
  scoutsUsed: number;
  maxLoad: number;
  minLoad: number;
  /** True when the roster is too small to fill every station every match. */
  rosterShortfall: boolean;
  loadByScout: ShiftBalancerLoad[];
};
