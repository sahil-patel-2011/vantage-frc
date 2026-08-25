// The mentor foreman view — pure aggregation over "Call Your Shot" ledger rows.
//
// Answers the one question the ledger exists for: "who is struggling, before the
// mentor who knew that subsystem graduates?" Everything here is arithmetic over
// rows the caller already fetched under RLS; nothing is invented, and nothing is
// scored below its stated minimum sample.
//
// THE ONE FLAG RULE (documented, deterministic, nothing else fires it):
//   "needs a mentor" fires for a member on a surface ONLY when they have at
//   least NEEDS_MENTOR_MIN_SCORED (= 4) graded calls on that surface and ZERO
//   of them were spot-on. Below the minimum the member is listed as
//   "not enough calls yet" — never scored, never flagged.
//
// Skips are visible debt (skip rate, count) but never feed the flag: a skip is
// a recorded escape hatch, not a wrong answer.
//
// Pure module: no DB, no React, no I/O.

import { LEARNING_SURFACES, learningSurfaceLabel, roleTier, type LearningSurface } from "./learning-mode";
import type { Closeness } from "./predictions";

/** Minimum graded calls on ONE surface before any judgement is allowed. */
export const NEEDS_MENTOR_MIN_SCORED = 4;

export type MentorViewCallRow = {
  userId: string;
  userName: string | null;
  surface: LearningSurface;
  closeness: Closeness | null;
  skipped: boolean;
  /** ISO timestamp. Rows may arrive in any order. */
  createdAt: string;
};

export type SurfaceRollupStatus = "needs_mentor" | "calibrating" | "not_enough_calls";

export type SurfaceRollup = {
  surface: LearningSurface;
  surfaceLabel: string;
  calls: number;
  scored: number;
  spotOn: number;
  close: number;
  off: number;
  skipped: number;
  /** skipped / calls, null when there are no calls at all. */
  skipRate: number | null;
  lastCalledAt: string | null;
  status: SurfaceRollupStatus;
  /** Human sentence stating exactly why the status is what it is. */
  note: string;
};

export type MemberRollup = {
  userId: string;
  userName: string;
  surfaces: SurfaceRollup[];
  totalCalls: number;
  totalSkipped: number;
  needsMentor: boolean;
  lastCalledAt: string | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

function later(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

function rollupSurface(surface: LearningSurface, rows: MentorViewCallRow[]): SurfaceRollup {
  const scoredRows = rows.filter((r) => !r.skipped && r.closeness != null);
  const spotOn = scoredRows.filter((r) => r.closeness === "spot-on").length;
  const close = scoredRows.filter((r) => r.closeness === "close").length;
  const off = scoredRows.filter((r) => r.closeness === "off").length;
  const skipped = rows.filter((r) => r.skipped).length;
  const lastCalledAt = rows.reduce<string | null>((last, r) => later(last, r.createdAt), null);
  const label = learningSurfaceLabel(surface);

  let status: SurfaceRollupStatus;
  let note: string;
  if (scoredRows.length < NEEDS_MENTOR_MIN_SCORED) {
    status = "not_enough_calls";
    note = `Not enough calls yet — ${scoredRows.length} of the ${NEEDS_MENTOR_MIN_SCORED} graded calls needed before anything is read into ${label.toLowerCase()}.`;
  } else if (spotOn === 0) {
    status = "needs_mentor";
    note = `${scoredRows.length} graded calls on ${label.toLowerCase()} with zero spot-on — worth a mentor sitting down with them.`;
  } else {
    status = "calibrating";
    note = `${scoredRows.length} graded calls on ${label.toLowerCase()}: ${spotOn} spot on, ${close} close, ${off} off.`;
  }

  return {
    surface,
    surfaceLabel: label,
    calls: rows.length,
    scored: scoredRows.length,
    spotOn,
    close,
    off,
    skipped,
    skipRate: rows.length > 0 ? round2(skipped / rows.length) : null,
    lastCalledAt,
    status,
    note,
  };
}

/**
 * Per-member, per-surface rollup. Only surfaces a member has actually touched
 * appear in their list — an untouched surface is absence of data, not a zero.
 * Members are ordered: flagged first, then by most recent activity.
 */
export function buildMentorRollup(rows: MentorViewCallRow[]): MemberRollup[] {
  const byMember = new Map<string, { userName: string; rows: MentorViewCallRow[] }>();
  for (const row of rows) {
    const existing = byMember.get(row.userId);
    if (existing) {
      existing.rows.push(row);
      if (!existing.userName && row.userName) existing.userName = row.userName;
    } else {
      byMember.set(row.userId, { userName: row.userName ?? "", rows: [row] });
    }
  }

  const members: MemberRollup[] = [];
  for (const [userId, group] of byMember) {
    const surfaces = LEARNING_SURFACES
      .map((surface) => ({ surface, rows: group.rows.filter((r) => r.surface === surface) }))
      .filter((s) => s.rows.length > 0)
      .map((s) => rollupSurface(s.surface, s.rows));
    members.push({
      userId,
      userName: group.userName || "Unnamed member",
      surfaces,
      totalCalls: group.rows.length,
      totalSkipped: group.rows.filter((r) => r.skipped).length,
      needsMentor: surfaces.some((s) => s.status === "needs_mentor"),
      lastCalledAt: surfaces.reduce<string | null>((last, s) => later(last, s.lastCalledAt), null),
    });
  }

  return members.sort((a, b) => {
    if (a.needsMentor !== b.needsMentor) return a.needsMentor ? -1 : 1;
    return (b.lastCalledAt ?? "").localeCompare(a.lastCalledAt ?? "");
  });
}

// ---- "learning mode is off for N members" -------------------------------

export type MemberModeRow = {
  userId: string;
  userName: string | null;
  role: string;
  /** The member's resolved default (per-surface overrides may still differ). */
  enabled: boolean;
};

export type LearningModeNote = {
  /** Student-tier members whose resolved default is OFF. */
  studentsOff: number;
  /** All student-tier members considered. */
  students: number;
  offNames: string[];
  /** Honest sentence, or null when there is nothing to say. */
  sentence: string | null;
};

/**
 * Mentors are counted nowhere here: learning mode is off for them by design,
 * so only student-tier members can make this note fire.
 */
export function summarizeLearningModeOff(members: MemberModeRow[]): LearningModeNote {
  const students = members.filter((m) => roleTier(m.role) === "student");
  const off = students.filter((m) => !m.enabled);
  const offNames = off.map((m) => m.userName?.trim() || "Unnamed member");
  const sentence =
    off.length === 0
      ? null
      : `Learning mode is off for ${off.length} of ${students.length} student${students.length === 1 ? "" : "s"} — their calculators reveal answers without a call. That is their choice to make; this note only keeps it visible.`;
  return { studentsOff: off.length, students: students.length, offNames, sentence };
}
