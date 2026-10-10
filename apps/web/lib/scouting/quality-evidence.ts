import { z } from "zod";
const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();
const fieldEvidence = z.object({ fieldKey: z.string(), checks: count, matches: count, conflicts: count, disagreementRate: rate, confidenceScore: rate });
export const qualityQuestionEvidenceSchema = fieldEvidence.extend({ schemaId: z.string().uuid(), label: z.string(), formTitle: z.string(), year: count, version: count });
export type QualityQuestionEvidence = z.infer<typeof qualityQuestionEvidenceSchema>;

/** Shared by Quality and the collection form's optional confidence hints. */
export const qualityEvidenceSchema = z.object({
  orgId: z.string().uuid(), eventKey: z.string().nullable(),
  fieldTrust: z.array(fieldEvidence),
  fieldTrustBySchema: z.array(qualityQuestionEvidenceSchema).optional(),
  leaderboard: z.array(z.object({ userId: z.string().uuid(), name: z.string(), entries: count, checks: count, matches: count, conflicts: count, accuracy: rate })),
});

/** Legacy aggregate hints cannot establish the meaning of the active question. */
export function qualityFieldsForSchema(evidence: { fieldTrustBySchema?: readonly QualityQuestionEvidence[] }, schemaId: string | null): QualityQuestionEvidence[] {
  return schemaId ? (evidence.fieldTrustBySchema ?? []).filter(row => row.schemaId === schemaId) : [];
}
