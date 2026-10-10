import { z } from "zod";
const scope = { orgId: z.string().uuid(), listId: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional() };
const entryId = z.string().uuid();
const tier = z.enum(["first_pick", "second_pick", "unranked", "avoid"]);
export const collabMutationRequest = z.discriminatedUnion("action", [
  z.object({ ...scope, action: z.literal("create-list"), name: z.string().trim().min(1).max(200), eventKey: z.string().trim().min(1).max(64).nullable().optional(), seasonYear: z.number().int().min(2001).max(2999).optional() }).strict(),
  z.object({ ...scope, action: z.literal("update-list-status"), status: z.enum(["open", "locked", "archived"]) }).strict(),
  z.object({ ...scope, action: z.literal("add-entry"), teamNumber: z.number().int().min(1).max(9999999), teamName: z.string().max(120).nullable().optional(), tier: tier.optional(), note: z.string().max(2000).nullable().optional() }).strict(),
  z.object({ ...scope, action: z.literal("move-entry"), entryId, tier, position: z.number().int().min(1).max(500) }).strict(),
  z.object({ ...scope, action: z.literal("set-order"), order: z.array(z.object({ tier, entryIds: z.array(entryId).max(500) }).strict()).min(1).max(4) }).strict(),
  z.object({ ...scope, action: z.literal("delete-entry"), entryId }).strict(),
  z.object({ ...scope, action: z.literal("set-entry-notes"), entryId, note: z.string().max(2000).nullable() }).strict(),
  z.object({ ...scope, action: z.literal("cast-vote"), entryId, weight: z.number().min(0.1).max(5).optional(), rankSuggestion: z.number().int().min(1).max(500).nullable().optional(), comment: z.string().max(1000).nullable().optional() }).strict(),
  z.object({ ...scope, action: z.literal("remove-vote"), entryId }).strict(),
]).superRefine((body, context) => {
  if (body.action !== "set-order") return;
  const ids = body.order.flatMap(group => group.entryIds);
  if (!ids.length || ids.length > 500 || new Set(ids).size !== ids.length || new Set(body.order.map(group => group.tier)).size !== body.order.length) {
    context.addIssue({ code: "custom", path: ["order"], message: "Each tier and entry must appear once in the saved order." });
  }
});
