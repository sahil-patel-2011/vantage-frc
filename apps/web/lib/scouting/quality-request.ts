import { z } from "zod";
import { coverageEventKey } from "./coverage-request";

export const qualityMeetingDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const qualitySeatRequest = z.object({
  eventKey: coverageEventKey,
  meetingOn: qualityMeetingDate,
  seatCount: z.number().int().min(1).max(10),
});

export const qualityPolicyRequest = z.object({
  schemaId: z.string().uuid().transform(value => value.toLowerCase()),
  fieldKey: z.string().min(1).max(120),
  preferredSource: z.enum(["scout", "tba", "statbotics", "consensus"]),
  officialKey: z.string().max(120).nullable().optional(),
  teamIndexed: z.boolean().optional(),
  enabled: z.boolean(),
  expectedUpdatedAt: z.string().min(1).max(80).nullable(),
});
