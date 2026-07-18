import { lintSchemaBudget } from "@vantage/scouting/trust";
import {
  assertSchemaIdentityLock,
  isScoutIdentityField,
  stripScoutIdentityFields,
  SCOUT_IDENTITY_LOCK_COPY,
} from "@vantage/scouting/identity";
import {
  DEFAULT_DRIVETRAIN_OPTIONS,
  type FieldDefinition,
  type FieldType,
  type FieldWidget,
  type SchemaDefinition,
} from "@vantage/scouting";

export { SCOUT_IDENTITY_LOCK_COPY };
export type AnswerKind = FieldWidget;

export const ANSWER_KIND_OPTIONS: Array<{
  kind: AnswerKind;
  label: string;
  hint: string;
}> = [
  { kind: "mc", label: "Multiple choice", hint: "Tap one option (radio)" },
  { kind: "short", label: "Short answer", hint: "Single-line text" },
  { kind: "free", label: "Free text", hint: "Longer notes" },
  { kind: "dropdown", label: "Dropdown", hint: "Select from a list" },
  { kind: "number", label: "Number", hint: "Counts and scores" },
  { kind: "yesno", label: "Yes / No", hint: "Checkbox" },
  {
    kind: "drivetrain",
    label: "Drivetrain type",
    hint: "Swerve, west coast, tank, mecanum, or other",
  },
  {
    kind: "robot_image",
    label: "Robot images",
    hint: "Upload or capture pit photos (org-isolated storage)",
  },
];

export const DRIVETRAIN_OPTIONS_TEXT = DEFAULT_DRIVETRAIN_OPTIONS.join(", ");

export type DraftQuestion = {
  id: string;
  label: string;
  kind: AnswerKind;
  required: boolean;
  optionsText: string;
};

export function newDraftQuestion(partial?: Partial<DraftQuestion>): DraftQuestion {
  const kind = partial?.kind ?? "short";
  return {
    id: partial?.id ?? `q_${Math.random().toString(36).slice(2, 10)}`,
    label: partial?.label ?? "",
    kind,
    required: partial?.required ?? false,
    optionsText:
      partial?.optionsText ??
      (kind === "drivetrain" ? DRIVETRAIN_OPTIONS_TEXT : ""),
  };
}

export function slugifyKey(label: string, used: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "field";
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

export function parseOptions(optionsText: string): string[] {
  return optionsText
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function kindToFieldType(kind: AnswerKind): FieldType {
  if (kind === "number") return "number";
  if (kind === "yesno") return "boolean";
  if (kind === "mc") return "multiple_choice";
  if (kind === "dropdown") return "dropdown";
  if (kind === "drivetrain") return "drivetrain_type";
  if (kind === "robot_image") return "robot_image";
  if (kind === "free") return "long_text";
  return "short_answer";
}

export function fieldToAnswerKind(field: FieldDefinition): AnswerKind {
  if (field.widget) return field.widget;
  if (field.type === "number") return "number";
  if (field.type === "boolean") return "yesno";
  if (field.type === "drivetrain_type") return "drivetrain";
  if (field.type === "robot_image") return "robot_image";
  if (field.type === "select" || field.type === "dropdown" || field.type === "multiple_choice") {
    return field.type === "multiple_choice" ? "mc" : "dropdown";
  }
  if (field.type === "long_text") return "free";
  if (field.type === "short_answer" || field.type === "text") return "short";
  return "short";
}

export function draftFromDefinition(definition: SchemaDefinition): {
  title: string;
  questions: DraftQuestion[];
} {
  const { definition: locked } = stripScoutIdentityFields(definition);
  return {
    title: locked.title,
    questions: locked.fields.map((field) =>
      newDraftQuestion({
        id: field.key,
        label: field.label,
        kind: fieldToAnswerKind(field),
        required: Boolean(field.required),
        optionsText:
          field.type === "drivetrain_type" && !(field.options?.length)
            ? DRIVETRAIN_OPTIONS_TEXT
            : (field.options ?? []).join(", "),
      }),
    ),
  };
}

export function definitionFromDraft(
  title: string,
  questions: DraftQuestion[],
): SchemaDefinition {
  const used = new Set<string>();
  const fields: FieldDefinition[] = questions.map((question) => {
    const type = kindToFieldType(question.kind);
    let key: string;
    if (question.kind === "drivetrain" && !used.has("drivetrain_type")) {
      key = "drivetrain_type";
      used.add(key);
    } else if (question.kind === "robot_image" && !used.has("robot_images")) {
      key = "robot_images";
      used.add(key);
    } else {
      key = slugifyKey(question.label || question.id, used);
    }
    const field: FieldDefinition = {
      key,
      label: question.label.trim() || "Untitled",
      type,
      required: question.required || undefined,
      widget: question.kind,
    };
    if (
      type === "select" ||
      type === "dropdown" ||
      type === "multiple_choice" ||
      type === "drivetrain_type"
    ) {
      const options = parseOptions(
        question.kind === "drivetrain" && !question.optionsText.trim()
          ? DRIVETRAIN_OPTIONS_TEXT
          : question.optionsText,
      );
      field.options =
        options.length > 0
          ? options
          : type === "drivetrain_type"
            ? [...DEFAULT_DRIVETRAIN_OPTIONS]
            : options;
    }
    if (type === "robot_image") {
      field.helpText = "Upload or capture pit photos of the robot.";
    }
    return field;
  });
  return { title: title.trim() || "Scouting form", fields };
}

export function moveQuestion(questions: DraftQuestion[], from: number, to: number): DraftQuestion[] {
  if (from < 0 || from >= questions.length) return questions;
  if (to < 0 || to >= questions.length) return questions;
  if (from === to) return questions;
  const next = questions.slice();
  const [item] = next.splice(from, 1);
  if (!item) return questions;
  next.splice(to, 0, item);
  return next;
}

export type FormBuilderValidation = {
  ok: boolean;
  errors: string[];
  budget: ReturnType<typeof lintSchemaBudget>;
};

export function validateDraft(title: string, questions: DraftQuestion[]): FormBuilderValidation {
  const errors: string[] = [];
  if (!title.trim()) errors.push("Give the form a title.");
  if (!questions.length) errors.push("Add at least one question.");
  const labels = new Set<string>();
  for (const [index, question] of questions.entries()) {
    const n = index + 1;
    if (!question.label.trim()) errors.push(`Question ${n} needs a label.`);
    if (isScoutIdentityField({ key: question.label, label: question.label })) {
      errors.push(
        `Question ${n} (“${question.label.trim()}”) is a free-text scout identity field — identity locks to membership userId.`,
      );
    }
    const labelKey = question.label.trim().toLowerCase();
    if (labelKey && labels.has(labelKey)) {
      errors.push(`Duplicate label: “${question.label.trim()}”.`);
    }
    if (labelKey) labels.add(labelKey);
    if (question.kind === "mc" || question.kind === "dropdown") {
      const options = parseOptions(question.optionsText);
      if (options.length < 2) {
        errors.push(`Question ${n} needs at least two options.`);
      }
    }
  }
  const definition = definitionFromDraft(title, questions);
  const identityError = assertSchemaIdentityLock(definition);
  if (identityError) errors.push(identityError);
  const budget = lintSchemaBudget(definition);
  return { ok: errors.length === 0, errors, budget };
}
