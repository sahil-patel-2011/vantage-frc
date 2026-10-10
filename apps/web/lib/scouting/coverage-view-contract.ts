import { z } from "zod";
import type { ScoutingCoverageView } from "./coverage";
import type { AssignmentResult } from "./coverage-request";

const count = z.number().int().nonnegative();
const strings = z.array(z.string());
const slot = z.object({ matchKey: z.string(), teamKey: z.string(), matchNumber: count, compLevel: z.string(),
  status: z.enum(["unscouted", "assigned", "covered", "double"]), assignmentCount: count, entryCount: count,
  teamNumber: z.number().nullable(), scoutNames: strings.optional(), scoutUserIds: strings.optional(),
  assignedScouts: z.array(z.object({ userId: z.string().uuid(), name: z.string(), role: z.string() })).optional() }).passthrough();
const view = z.discriminatedUnion("status", [
  z.object({ status: z.literal("setup_required"), orgId: z.string().uuid().nullable(), eventKey: z.null(), generatedAt: z.string(), message: z.string(), steps: z.array(z.object({ id: z.string(), label: z.string(), detail: z.string(), href: z.string() })) }).passthrough(),
  z.object({ status: z.literal("live"), orgId: z.string().uuid(), eventKey: z.string(), eventName: z.string().nullable(), teamNumber: z.number().nullable(), generatedAt: z.string(), qualsOnly: z.boolean(), canAssign: z.boolean(),
    summary: z.object({ totalSlots: count, unscouted: count, assignedWaiting: count, covered: count, doubleCovered: count, coverageRate: z.number().nullable(), doubleRate: z.number().nullable() }),
    live: z.object({ focusMatchKeys: strings, focusSlots: z.array(slot), gapSlots: z.array(slot), doubleSlots: z.array(slot) }),
    slots: z.array(slot), playedMatchKeys: strings,
    scope: z.object({ playedMatches: count, playedRobots: count, playedScouted: count, playedMissed: count, upcomingMatches: count, upcomingRobots: count, upcomingNoScout: count, reportsBeforePlay: count }),
    scouts: z.array(z.object({ userId: z.string().uuid(), name: z.string(), role: z.string(), assignedCount: count, isMe: z.boolean() })),
    schemaRoles: z.object({ status: z.string(), warnings: z.array(z.object({ id: z.string(), severity: z.enum(["blocking", "warning"]), message: z.string() })) }).passthrough(),
  }).passthrough(),
]);
const result = z.object({ action: z.enum(["assign", "swap", "assign-range", "auto-assign"]), assigned: count, unchanged: count, refused: strings });
export function isCoverageView(value: unknown, scope: { orgId: string; eventKey?: string; qualsOnly: boolean }): value is ScoutingCoverageView {
  const parsed = view.safeParse(value);
  if (!parsed.success || parsed.data.orgId !== scope.orgId) return false;
  return parsed.data.status !== "live" || ((!scope.eventKey || parsed.data.eventKey === scope.eventKey) && parsed.data.qualsOnly === scope.qualsOnly);
}
export function assignmentResult(value: unknown, action: AssignmentResult["action"]): AssignmentResult | null {
  const parsed = result.safeParse(value);
  return parsed.success && parsed.data.action === action ? parsed.data : null;
}
