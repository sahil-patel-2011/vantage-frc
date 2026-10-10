import { z } from "zod";

export const pickListRankingRequest = z.object({
  orgId: z.string().uuid(), id: z.string().uuid().optional(), eventKey: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200), expectedRevision: z.number().int().positive().nullable().optional(),
  entries: z.array(z.object({
    teamKey: z.string().regex(/^frc[1-9]\d{0,6}$/), rank: z.number().int().min(1).max(500),
    tier: z.string().max(64).optional(), notes: z.string().max(2000).nullable().optional(),
  }).strict()).max(500),
}).strict().superRefine((value, context) => {
  const teams = new Set<string>(); const ranks = new Set<number>();
  for (const entry of value.entries) {
    if (teams.has(entry.teamKey) || ranks.has(entry.rank) || entry.rank > value.entries.length) {
      context.addIssue({ code: "custom", message: "Team identities and dense ranks must be unique", path: ["entries"] });
    }
    teams.add(entry.teamKey); ranks.add(entry.rank);
  }
});
