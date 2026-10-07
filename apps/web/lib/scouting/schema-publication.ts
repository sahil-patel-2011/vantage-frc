import { z } from "zod";
import { cyclicVisibilityKeys, isVisibleWhen, type VisibleWhen } from "@vantage/scouting/visibility";

const fieldTypes = ["number", "boolean", "text", "select", "dropdown", "multiple_choice", "short_answer", "long_text",
  "drivetrain_type", "robot_image", "counter", "multi_counter", "timer", "rating", "multi_select", "slider",
  "section_header", "field_position", "auto_path"] as const;
const widgets = ["mc", "short", "free", "dropdown", "number", "yesno", "drivetrain", "robot_image", "counter",
  "multi_counter", "timer", "rating", "multi_select", "slider", "section", "field_position", "auto_path"] as const;

export const scoutSchemaDefinitionShape = z.object({
  title: z.string().trim().min(1).max(200),
  fields: z.array(z.object({
    key: z.string().min(1).max(200).refine(key => key.trim() === key && !["__proto__", "prototype", "constructor"].includes(key)),
    label: z.string().trim().min(1).max(300),
    type: z.enum(fieldTypes),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1).max(300).refine(option => option.trim().length > 0)).max(200).optional(),
    disagreementThreshold: z.number().finite().nonnegative().optional(),
    helpText: z.string().max(2_000).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    visibleWhen: z.custom<VisibleWhen>(isVisibleWhen).nullable().optional(),
    widget: z.enum(widgets).optional(),
  }).passthrough()).min(1).max(200),
}).passthrough();

const definition = scoutSchemaDefinitionShape.superRefine((value, context) => {
  const keys = new Set<string>();
  const availableKeys = new Set(value.fields.map(field => field.key));
  const cyclic = new Set(cyclicVisibilityKeys(value.fields));
  for (const [index, field] of value.fields.entries()) {
    if (cyclic.has(field.key)) context.addIssue({ code: "custom", path: ["fields", index, "visibleWhen"], message: "Conditional questions cannot depend on each other in a circle." });
    if (keys.has(field.key)) context.addIssue({ code: "custom", path: ["fields", index, "key"], message: "Question keys must be unique." });
    keys.add(field.key);
    const rule = field.visibleWhen ?? field.config?.visibleWhen;
    if (rule != null) {
      if (!isVisibleWhen(rule)) context.addIssue({ code: "custom", path: ["fields", index, "config", "visibleWhen"], message: "Conditional questions need valid answer rules." });
      else {
        const clauses = "allOf" in rule ? rule.allOf : "anyOf" in rule ? rule.anyOf : [rule];
        if (clauses.some(clause => !availableKeys.has(clause.fieldKey) || clause.fieldKey === field.key)) {
          context.addIssue({ code: "custom", path: ["fields", index, "config", "visibleWhen"], message: "Answer rules must refer to another question on this form." });
        }
      }
    }
    if (["select", "dropdown", "multiple_choice", "multi_select"].includes(field.type) && !field.options?.length) {
      context.addIssue({ code: "custom", path: ["fields", index, "options"], message: "Choice questions need options." });
    }
    if (field.options && new Set(field.options).size !== field.options.length) {
      context.addIssue({ code: "custom", path: ["fields", index, "options"], message: "Options must be unique." });
    }
  }
});

/** Validate before identity/budget readers or persistence can consume a schema. */
export const schemaPublicationRequest = z.union([
  z.object({ orgId: z.string().uuid(), action: z.literal("ensure_defaults") }).strict(),
  z.object({
    orgId: z.string().uuid(), year: z.number().int().min(1992).max(2100), type: z.enum(["match", "pit"]),
    definition, acknowledgeBudget: z.boolean().optional(),
    baseSchemaId: z.string().uuid().nullable().optional(),
  }).strict(),
]);
