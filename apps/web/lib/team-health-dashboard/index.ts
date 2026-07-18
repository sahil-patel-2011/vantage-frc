// Pure, unit-testable helpers for the Team Health Dashboard. No I/O, no framework imports.

import type {
  TeamHealthPulse,
  TeamHealthReadiness,
  TeamHealthSummary,
  TeamHealthTier,
  TeamHealthTrendPoint,
} from "./types";

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function moraleLabel(rating: number): string {
  const rounded = Math.round(rating);
  if (rounded <= 1) return "Struggling";
  if (rounded === 2) return "Low";
  if (rounded === 3) return "Steady";
  if (rounded === 4) return "Good";
  return "Excellent";
}

/** Blends attendance, net task throughput, and engagement into a single 0..1 health score. */
export function pulseHealthScore(pulse: TeamHealthPulse): number {
  const attendance = clamp01(pulse.attendanceRate / 100);
  const engagement = clamp01(pulse.engagementScore / 100);
  const morale = clamp01((pulse.moraleRating - 1) / 4);
  const totalTasks = pulse.tasksCompleted + pulse.tasksOpen;
  const throughput = totalTasks > 0 ? clamp01(pulse.tasksCompleted / totalTasks) : 0.5;
  const overduePenalty = totalTasks > 0 ? clamp01(pulse.tasksOverdue / totalTasks) : 0;
  const score = attendance * 0.3 + engagement * 0.25 + morale * 0.2 + throughput * 0.25 - overduePenalty * 0.15;
  return clamp01(score);
}

export function summarizeTeamHealth(pulses: TeamHealthPulse[]): TeamHealthSummary {
  const sorted = [...pulses].sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  const trend: TeamHealthTrendPoint[] = sorted.map((pulse) => {
    const totalTasks = pulse.tasksCompleted + pulse.tasksOpen;
    return {
      periodLabel: pulse.periodLabel,
      periodStart: pulse.periodStart,
      attendanceRate: pulse.attendanceRate,
      taskThroughput: totalTasks > 0 ? round1((pulse.tasksCompleted / totalTasks) * 100) : 0,
      engagementScore: pulse.engagementScore,
      moraleRating: pulse.moraleRating,
      healthScore: round1(pulseHealthScore(pulse) * 100),
    };
  });

  const latestPulse = sorted.length > 0 ? (sorted[sorted.length - 1] ?? null) : null;
  const healthSignal = pulses.length > 0 ? average(pulses.map(pulseHealthScore)) : 0;

  return {
    totalPulses: pulses.length,
    latestPulse,
    avgAttendanceRate: pulses.length > 0 ? round1(average(pulses.map((p) => p.attendanceRate))) : 0,
    avgEngagementScore: pulses.length > 0 ? round1(average(pulses.map((p) => p.engagementScore))) : 0,
    avgMoraleRating: pulses.length > 0 ? round1(average(pulses.map((p) => p.moraleRating))) : 0,
    totalTasksCompleted: pulses.reduce((sum, p) => sum + p.tasksCompleted, 0),
    totalTasksOpen: pulses.reduce((sum, p) => sum + p.tasksOpen, 0),
    totalTasksOverdue: pulses.reduce((sum, p) => sum + p.tasksOverdue, 0),
    trend,
    healthSignal: clamp01(healthSignal),
  };
}

function tierFromScore(score: number): TeamHealthTier {
  if (score >= 0.7) return "thriving";
  if (score >= 0.4) return "steady";
  return "at_risk";
}

export function computeTeamHealthReadiness(summary: TeamHealthSummary): TeamHealthReadiness {
  const attendance = clamp01(summary.avgAttendanceRate / 100);
  const engagement = clamp01(summary.avgEngagementScore / 100);
  const morale = clamp01((summary.avgMoraleRating - 1) / 4);
  const totalTasks = summary.totalTasksCompleted + summary.totalTasksOpen;
  const taskFlow = totalTasks > 0 ? clamp01(summary.totalTasksCompleted / totalTasks) : 0;
  const cadence = clamp01(summary.totalPulses / 8);

  const components = { attendance, taskFlow, engagement, morale, cadence };
  const score = clamp01(
    attendance * 0.28 + taskFlow * 0.24 + engagement * 0.22 + morale * 0.16 + cadence * 0.1,
  );

  const recommendations: string[] = [];
  if (summary.totalPulses === 0) {
    recommendations.push("Log your first team-health pulse to start tracking trends.");
  } else {
    if (attendance < 0.6) recommendations.push("Attendance is trending low — check in on scheduling conflicts.");
    if (taskFlow < 0.5) recommendations.push("Task completion is lagging open work — review the task board backlog.");
    if (engagement < 0.5) recommendations.push("Engagement score is soft — consider a team check-in or retro.");
    if (morale < 0.5) recommendations.push("Morale ratings are low — surface blockers with mentors/leads.");
    if (summary.totalTasksOverdue > 0) recommendations.push(`${summary.totalTasksOverdue} overdue task(s) logged — triage them.`);
    if (cadence < 0.5) recommendations.push("Log pulses more regularly for a reliable trend.");
  }

  return {
    score,
    tier: tierFromScore(score),
    components,
    pulsesLogged: summary.totalPulses,
    recommendations,
  };
}
