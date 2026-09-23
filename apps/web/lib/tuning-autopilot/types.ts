// Tuning autopilot domain types. Pure data shapes — no I/O, no framework imports.
// A tuning session targets one subsystem/controller (e.g. "Arm — PID", "Drivetrain — Feedforward").
// Each iteration records the gain set that was actually run on the robot plus the observed test
// result (overshoot, settling time, steady-state error, oscillation). The next suggested gain set
// is derived only from the session's own logged iteration trend — nothing is fabricated.

export type TuningControllerType = "pid" | "pidf" | "feedforward";

export type TuningSessionStatus = "active" | "converged" | "abandoned";

export type TuningGains = {
  kP: number;
  kI: number;
  kD: number;
  /** Feedforward static-friction term. */
  kS: number;
  /** Feedforward velocity term. */
  kV: number;
  /** Feedforward gravity term. */
  kG: number;
};

export type TuningIterationResult = {
  overshootPct: number;
  settlingTimeSec: number;
  steadyStateError: number;
  oscillating: boolean;
};

export type TuningIteration = {
  id: string;
  sessionId: string;
  iterationIndex: number;
  gains: TuningGains;
  result: TuningIterationResult;
  notes: string;
  loggedBy?: string;
  createdAt: string;
};

export type TuningSession = {
  id: string;
  seasonYear: number;
  subsystem: string;
  controllerType: TuningControllerType;
  goal: string;
  status: TuningSessionStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

/** Session delete uses created_by; iteration delete uses logged_by. Owners and admins may delete either. */
export function canDeleteTuningAutopilotRow(input: {
  role?: string | null;
  userId?: string | null;
  authorId?: string | null;
}): boolean {
  const role = (input.role ?? "").toLowerCase();
  if (role === "owner" || role === "admin") return true;
  const userId = input.userId ?? "";
  const authorId = input.authorId ?? "";
  return userId.length > 0 && userId === authorId;
}

export type ScoredIteration = TuningIteration & { score: number };

export type TuningSuggestion = {
  gains: TuningGains;
  rationale: string[];
  /** Iteration ids this suggestion was derived from (baseline + best). */
  basedOnIterationIds: string[];
  /** 0..1 — higher when more iterations support the trend. */
  confidence: number;
  /** True when the latest iteration already matches/exceeds the best logged result. */
  converged: boolean;
};

export type TuningSessionDetail = {
  session: TuningSession;
  iterations: ScoredIteration[];
  bestIterationId: string | null;
  suggestion: TuningSuggestion | null;
};
