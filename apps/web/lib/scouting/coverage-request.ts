import { z } from "zod";
import { normalizeAssignmentTeamKey, parseMatchKey } from "./assignment-range";

export const coverageEventKey = z.string().trim().min(1).max(120).regex(/^[a-z0-9_-]+$/i);
const matchKey = z.string().trim().max(160).refine(value => parseMatchKey(value) !== null);
const teamKey = z.string().trim().max(16).transform(normalizeAssignmentTeamKey).refine(value => value !== null).transform(value => value!);
const scope = { orgId: z.string().uuid(), eventKey: coverageEventKey.optional(), qualsOnly: z.boolean().optional(), focusMatchKey: matchKey.optional() };
export const coverageMutationRequest = z.discriminatedUnion("action", [
  z.object({ ...scope, action: z.literal("assign"), matchKey, teamKey, userId: z.string().uuid().optional() }).strict(),
  z.object({ ...scope, action: z.literal("swap"), matchKey, teamKey, fromUserId: z.string().uuid(), toUserId: z.string().uuid() }).strict(),
  z.object({ ...scope, action: z.literal("assign-range"), firstMatchKey: matchKey, lastMatchKey: matchKey, teamKey, userId: z.string().uuid().optional() }).strict(),
  z.object({ ...scope, action: z.literal("auto-assign") }).strict(),
]);
export type CoverageMutation = z.infer<typeof coverageMutationRequest>;
export type CoverageCommand = { [Action in CoverageMutation["action"]]: Omit<Extract<CoverageMutation, { action: Action }>, "orgId"> }[CoverageMutation["action"]];
export type AssignmentResult = { action: CoverageMutation["action"]; assigned: number; unchanged: number; refused: string[] };
