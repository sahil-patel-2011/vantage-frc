import { z } from "zod";

const count = z.number().int().nonnegative();
const value = z.number().nullable();
const flag = z.enum(["ok", "review", "partial", "no_scouting", "no_official"]);
const robot = z.object({
  teamKey: z.string(), estimate: value, basis: z.enum(["total", "formula"]).nullable(),
  fields: z.array(z.string()), scoutCount: count, range: z.tuple([z.number(), z.number()]).nullable().optional(),
  entryIds: z.array(z.string()),
});
const alliance = z.object({
  side: z.enum(["red", "blue"]), officialSource: z.enum(["breakdown", "alliance_score"]).nullable(),
  teamKeys: z.array(z.string()), robots: z.array(robot), scoutedRobots: count,
  ourTotal: value, officialTotal: value, officialFoulPoints: value, officialScoringTotal: value,
  delta: value, deltaPct: value, flag, message: z.string(),
});
const distribution = z.discriminatedUnion("status", [
  z.object({ status: z.literal("distributed"), officialTotal: z.number(),
    robots: z.array(z.object({ teamKey: z.string(), estimate: z.number(), share: z.number().min(0).max(1), points: z.number() })) }),
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
]);

export const reconcileViewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("setup_required"), orgId: z.string().uuid(), eventKey: z.string().nullable(), generatedAt: z.string(), message: z.string() }),
  z.object({
    status: z.literal("live"), orgId: z.string().uuid(), eventKey: z.string(), generatedAt: z.string(),
    reviewDeltaPct: z.number().positive(), scoutedEntries: count, truncated: z.boolean(),
    summary: z.object({ matches: count, comparedAlliances: count, flaggedMatches: count, matchesWithoutBreakdown: count,
      matchesWithoutScouting: count, meanAbsDeltaPct: z.number().nonnegative().nullable() }),
    matches: z.array(z.object({ matchKey: z.string(), matchNumber: count, compLevel: z.string(), red: alliance, blue: alliance,
      flag, worstDeltaPct: value, needsReview: z.boolean(), distribution: z.object({ red: distribution, blue: distribution }) })),
  }),
]);
export type ReconcileView = z.infer<typeof reconcileViewSchema>;

export function scopedReconcileView(input: unknown, orgId: string, eventKey: string | null): ReconcileView | null {
  const parsed = reconcileViewSchema.safeParse(input);
  if (!parsed.success || parsed.data.orgId !== orgId || (eventKey && parsed.data.eventKey !== eventKey)) return null;
  const view = parsed.data;
  if (view.status === "live" && view.matches.some(match => !match.matchKey.startsWith(`${view.eventKey}_`))) return null;
  return view;
}
