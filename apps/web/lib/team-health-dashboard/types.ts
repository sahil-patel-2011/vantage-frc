// Team Health Dashboard domain types. Pure data shapes — no I/O, no framework imports.
// Unifies attendance, task throughput, and engagement into one team-health signal, built
// entirely from pulses the team logs itself (never inferred/fabricated).

export type TeamHealthPulse = {
  id: string;
  periodLabel: string;
  periodStart: string;
  attendanceRate: number;
  membersPresent: number;
  membersTotal: number;
  tasksCompleted: number;
  tasksOpen: number;
  tasksOverdue: number;
  engagementScore: number;
  moraleRating: number;
  seasonYear: number;
  notes: string | null;
};

export type TeamHealthTrendPoint = {
  periodLabel: string;
  periodStart: string;
  attendanceRate: number;
  taskThroughput: number;
  engagementScore: number;
  moraleRating: number;
  healthScore: number;
};

export type TeamHealthSummary = {
  totalPulses: number;
  latestPulse: TeamHealthPulse | null;
  avgAttendanceRate: number;
  avgEngagementScore: number;
  avgMoraleRating: number;
  totalTasksCompleted: number;
  totalTasksOpen: number;
  totalTasksOverdue: number;
  trend: TeamHealthTrendPoint[];
  /** 0..1 overall team-health signal blending attendance, task throughput, and engagement. */
  healthSignal: number;
};

export type TeamHealthTier = "at_risk" | "steady" | "thriving";

export type TeamHealthReadiness = {
  score: number;
  tier: TeamHealthTier;
  components: {
    attendance: number;
    taskFlow: number;
    engagement: number;
    morale: number;
    cadence: number;
  };
  pulsesLogged: number;
  recommendations: string[];
};
