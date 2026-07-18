// Pure helper functions for Alliance Sim — role catalog, labels, validation, and the
// greedy role-assignment / conflict-detection / win-probability computation. No I/O.

import type {
  AllianceSimResult,
  AllianceSimRobot,
  AllianceSimRole,
  AllianceSimRoleDef,
  RoleAssignment,
  RoleConflict,
} from "./types";

export const ALLIANCE_SIM_ROLE_DEFS: AllianceSimRoleDef[] = [
  { role: "primary_climb", label: "Primary climb", capacity: 1, essential: true },
  { role: "secondary_climb", label: "Secondary climb", capacity: 1, essential: false },
  { role: "primary_score_high", label: "High scoring", capacity: 1, essential: true },
  { role: "primary_score_low", label: "Low scoring", capacity: 1, essential: false },
  { role: "defense", label: "Defense", capacity: 1, essential: false },
  { role: "feeder", label: "Human-player feeder", capacity: 1, essential: false },
  { role: "auto_mobility", label: "Auto mobility", capacity: 3, essential: true },
];

export const ALLIANCE_SIM_ROLES: AllianceSimRole[] = ALLIANCE_SIM_ROLE_DEFS.map((d) => d.role);

const ROLE_LABELS: Record<AllianceSimRole, string> = Object.fromEntries(
  ALLIANCE_SIM_ROLE_DEFS.map((d) => [d.role, d.label]),
) as Record<AllianceSimRole, string>;

const ROLE_CAPACITY: Record<AllianceSimRole, number> = Object.fromEntries(
  ALLIANCE_SIM_ROLE_DEFS.map((d) => [d.role, d.capacity]),
) as Record<AllianceSimRole, number>;

export const DEFAULT_ROLE_STRENGTH = 3;
export const MIN_ROLE_STRENGTH = 1;
export const MAX_ROLE_STRENGTH = 5;

export function allianceSimRoleLabel(role: AllianceSimRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function isAllianceSimRole(value: unknown): value is AllianceSimRole {
  return typeof value === "string" && (ALLIANCE_SIM_ROLES as string[]).includes(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function strengthFor(robot: AllianceSimRobot, role: AllianceSimRole): number {
  const raw = robot.roleStrengths[role];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(MAX_ROLE_STRENGTH, Math.max(MIN_ROLE_STRENGTH, Math.round(raw)));
  }
  return DEFAULT_ROLE_STRENGTH;
}

const EMPTY_RESULT: AllianceSimResult = {
  assignments: [],
  conflicts: [],
  coverageRatio: 0,
  essentialCoverage: 0,
  winProbability: 0,
  totalStrength: 0,
  maxPossibleStrength: 0,
};

/**
 * Greedily assigns each robot to at most one physical role (highest declared strength
 * first), respecting per-role capacity, then reports the roles where more capable robots
 * existed than the role had room for (physical conflicts) and a coverage-derived win %.
 */
export function computeAllianceSimResult(robots: AllianceSimRobot[]): AllianceSimResult {
  if (robots.length === 0) return EMPTY_RESULT;

  type Candidate = { role: AllianceSimRole; robotId: string; teamNumber: number; strength: number };
  const candidates: Candidate[] = [];
  for (const robot of robots) {
    for (const role of robot.capableRoles) {
      candidates.push({ role, robotId: robot.id, teamNumber: robot.teamNumber, strength: strengthFor(robot, role) });
    }
  }
  candidates.sort((a, b) => b.strength - a.strength);

  const capacityLeft: Record<string, number> = {};
  for (const def of ALLIANCE_SIM_ROLE_DEFS) capacityLeft[def.role] = def.capacity;

  const assignments: RoleAssignment[] = [];
  const assignedRobots = new Set<string>();
  for (const candidate of candidates) {
    if (assignedRobots.has(candidate.robotId)) continue;
    if ((capacityLeft[candidate.role] ?? 0) <= 0) continue;
    assignments.push({
      role: candidate.role,
      robotId: candidate.robotId,
      teamNumber: candidate.teamNumber,
      strength: candidate.strength,
    });
    assignedRobots.add(candidate.robotId);
    capacityLeft[candidate.role] = (capacityLeft[candidate.role] ?? 0) - 1;
  }

  const conflicts: RoleConflict[] = [];
  for (const def of ALLIANCE_SIM_ROLE_DEFS) {
    const capableRobots = robots.filter((r) => r.capableRoles.includes(def.role));
    if (capableRobots.length <= def.capacity) continue;
    const assignedIds = new Set(assignments.filter((a) => a.role === def.role).map((a) => a.robotId));
    conflicts.push({
      role: def.role,
      capacity: def.capacity,
      contenders: capableRobots.map((r) => ({
        robotId: r.id,
        teamNumber: r.teamNumber,
        strength: strengthFor(r, def.role),
      })),
      unassigned: capableRobots
        .filter((r) => !assignedIds.has(r.id))
        .map((r) => ({ robotId: r.id, teamNumber: r.teamNumber })),
    });
  }

  const totalStrength = assignments.reduce((sum, a) => sum + a.strength, 0);
  const maxPossibleStrength = robots.reduce((sum, r) => {
    if (r.capableRoles.length === 0) return sum;
    const best = Math.max(...r.capableRoles.map((role) => strengthFor(r, role)));
    return sum + best;
  }, 0);
  const coverageRatio = maxPossibleStrength > 0 ? clamp01(totalStrength / maxPossibleStrength) : 0;

  const essentialDefs = ALLIANCE_SIM_ROLE_DEFS.filter((d) => d.essential);
  const essentialFilled = essentialDefs.filter((d) => assignments.some((a) => a.role === d.role)).length;
  const essentialCoverage = essentialDefs.length > 0 ? essentialFilled / essentialDefs.length : 0;

  const winProbability = clamp01(0.3 + 0.5 * coverageRatio + 0.2 * essentialCoverage);

  return {
    assignments,
    conflicts,
    coverageRatio,
    essentialCoverage,
    winProbability,
    totalStrength,
    maxPossibleStrength,
  };
}

export function roleCapacity(role: AllianceSimRole): number {
  return ROLE_CAPACITY[role] ?? 1;
}

export * from "./types";
