import { z } from "zod";
import { isFormulaExpression, type FormulaExpression } from "@vantage/scouting";

export const formulaRequest = z.object({
  orgId: z.string().uuid(), name: z.string().trim().min(1).max(100),
  expression: z.custom<FormulaExpression>(isFormulaExpression, "Choose valid scoring terms. Expressions must stay within the size limit."),
  schemaId: z.string().uuid(), baseRevision: z.string().min(1).max(80).nullable().optional(),
}).strict();
