// Field Reset Timer domain types. Pure data shapes — no I/O, no framework imports.
// Tracks driver-practice field-reset cycles: how long it takes to reset field elements
// between runs, and the full drive cycle time, so a team can see whether reset speed
// and cycle consistency are actually improving across practice sessions.

export type FieldResetTimerSession = {
  id: string;
  label: string;
  /** ISO date (YYYY-MM-DD). */
  occurredOn: string;
  seasonYear: number;
  notes: string | null;
  cycleCount: number;
};

export type FieldResetTimerCycle = {
  id: string;
  sessionId: string;
  cycleNumber: number;
  resetSeconds: number;
  cycleSeconds: number | null;
  note: string | null;
  recordedAt: string;
};

export type FieldResetTimerSessionSummary = {
  sessionId: string;
  cycleCount: number;
  avgResetSeconds: number;
  bestResetSeconds: number;
  worstResetSeconds: number;
  avgCycleSeconds: number | null;
  /** 0..1: 1 means every reset lands close to the average (tight, repeatable resets). */
  consistency: number;
};

export type FieldResetTimerTier = "emerging" | "developing" | "tight";

export type FieldResetTimerReadiness = {
  /** 0..1 overall reset-drilling readiness. */
  score: number;
  tier: FieldResetTimerTier;
  sessionsLogged: number;
  totalCycles: number;
  bestResetSeconds: number | null;
  avgResetSeconds: number | null;
  consistency: number;
  recommendations: string[];
};
