import { z } from "zod";
const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();

/** Shared by Quality and the collection form's optional confidence hints. */
export const qualityEvidenceSchema = z.object({
  orgId: z.string().uuid(), eventKey: z.string().nullable(),
  fieldTrust: z.array(z.object({ fieldKey: z.string(), checks: count, matches: count, conflicts: count, disagreementRate: rate, confidenceScore: rate })),
  leaderboard: z.array(z.object({ userId: z.string().uuid(), name: z.string(), entries: count, checks: count, matches: count, conflicts: count, accuracy: rate })),
});
