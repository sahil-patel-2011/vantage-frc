import { z } from "zod";
import { coverageEventKey } from "../scouting/coverage-request";
import { parseMatchKey } from "../scouting/assignment-range";
import { MAX_REPORT_TARGET } from "./types";
const scope = { orgId: z.string().uuid(), eventKey: coverageEventKey };
export const reviewMutationRequest = z.discriminatedUnion("action", [
  z.object({ ...scope, action: z.literal("set-threshold"), thinThreshold: z.number().int().min(1).max(MAX_REPORT_TARGET), expectedThreshold: z.number().int().min(1).max(2_147_483_647).optional() }).strict(),
  z.object({ ...scope, action: z.literal("send-nudge"), matchKey: z.string().max(160).refine(value => parseMatchKey(value) !== null), teamKey: z.string().regex(/^frc[1-9]\d{0,5}[a-z]?$/), message: z.string().trim().min(1).max(500) }).strict(),
  z.object({ ...scope, action: z.literal("acknowledge-nudge"), nudgeId: z.string().uuid() }).strict(),
]);
export type ReviewMutation = z.infer<typeof reviewMutationRequest>;
export type ReviewCommand = { [Action in ReviewMutation["action"]]: Omit<Extract<ReviewMutation, { action: Action }>, "orgId" | "eventKey"> }[ReviewMutation["action"]];
export type ReviewResult =
  | { action: "set-threshold"; thinThreshold: number }
  | { action: "send-nudge"; nudgeId: string; matchKey: string; teamKey: string; created: boolean }
  | { action: "acknowledge-nudge"; nudgeId: string; acknowledgedAt: string };
