import { z } from "zod";
import type { ScoutCoverageLiveView } from "./compute-scout-coverage-live";
import type { ReviewCommand, ReviewResult } from "./request";
import { MAX_REPORT_TARGET } from "./types";
const count = z.number().int().nonnegative();
const cell = z.object({ matchKey: z.string(), matchLabel: z.string(), compLevel: z.string(), matchNumber: count, teamKey: z.string(), teamNumber: count,
  alliance: z.enum(["red", "blue"]), entryCount: count, status: z.enum(["zero", "thin", "covered"]), played: z.boolean().optional(), assignmentCount: count.optional() });
const nudge = z.object({ id: z.string().uuid(), matchKey: z.string(), matchLabel: z.string(), teamKey: z.string(), teamNumber: count,
  message: z.string(), sentBy: z.string().uuid(), sentAt: z.string(), acknowledged: z.boolean(), acknowledgedAt: z.string().nullable() });
const view = z.discriminatedUnion("status", [
  z.object({ status: z.literal("setup_required"), orgId: z.string().uuid().nullable(), eventKey: z.string().nullable(), message: z.string(), steps: z.array(z.object({ id: z.string(), label: z.string(), detail: z.string(), href: z.string() })) }),
  z.object({ status: z.literal("live"), orgId: z.string().uuid(), eventKey: z.string(), eventName: z.string().nullable(), teamNumber: z.number().nullable(), canManage: z.boolean(), thinThreshold: z.number().int().positive(),
    computedAt: z.string(), cells: z.array(cell), gaps: z.array(cell), nudges: z.array(nudge),
    summary: z.object({ totalCells: count, zeroCount: count, thinCount: count, coveredCount: count, coveragePct: z.number().min(0).max(1) }),
    scope: z.object({ playedMatches: count, playedRobots: count, playedScouted: count, playedMissed: count, upcomingMatches: count, upcomingRobots: count, upcomingNoScout: count, reportsBeforePlay: count }).optional(),
    missed: z.array(z.object({ matchKey: z.string(), matchLabel: z.string(), teamKey: z.string(), userId: z.string().uuid(), name: z.string(), role: z.enum(["primary", "backup"]), robotScouted: z.boolean() })).optional(),
  }),
]);
const result = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-threshold"), thinThreshold: z.number().int().min(1).max(MAX_REPORT_TARGET) }),
  z.object({ action: z.literal("send-nudge"), nudgeId: z.string().uuid(), matchKey: z.string(), teamKey: z.string(), created: z.boolean() }),
  z.object({ action: z.literal("acknowledge-nudge"), nudgeId: z.string().uuid(), acknowledgedAt: z.string().min(1) }),
]);
export function isReviewView(value: unknown, orgId: string, eventKey?: string): value is ScoutCoverageLiveView {
  const parsed = view.safeParse(value);
  return parsed.success && parsed.data.orgId === orgId && (!eventKey || parsed.data.eventKey === eventKey || parsed.data.eventKey === null);
}
export function confirmedReviewResult(value: unknown, command: ReviewCommand): ReviewResult | null {
  const parsed = result.safeParse(value);
  if (!parsed.success) return null;
  const saved = parsed.data;
  if (saved.action === "set-threshold" && command.action === saved.action && saved.thinThreshold === command.thinThreshold) return saved;
  if (saved.action === "send-nudge" && command.action === saved.action && saved.matchKey === command.matchKey && saved.teamKey === command.teamKey) return saved;
  if (saved.action === "acknowledge-nudge" && command.action === saved.action && saved.nudgeId === command.nudgeId) return saved;
  return null;
}
