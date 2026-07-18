import { lintSchemaBudget } from "@vantage/scouting/trust";
import {
  assertSchemaIdentityLock,
  isScoutIdentityField,
  stripScoutIdentityFields,
  SCOUT_IDENTITY_LOCK_COPY,
} from "@vantage/scouting/identity";
import {
  DEFAULT_DRIVETRAIN_OPTIONS,
  type EntryType,
  type FieldDefinition,
  type FieldType,
  type FieldWidget,
  type SchemaDefinition,
} from "@vantage/scouting";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

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

/** Persist option editor rows back into draft `optionsText`. */
export function serializeOptions(options: string[]): string {
  return options.map((part) => part.trim()).filter(Boolean).join(", ");
}

export function moveOption(options: string[], from: number, to: number): string[] {
  if (from < 0 || from >= options.length) return options;
  if (to < 0 || to >= options.length) return options;
  if (from === to) return options;
  const next = options.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return options;
  next.splice(to, 0, item);
  return next;
}

export function updateOptionAt(options: string[], index: number, value: string): string[] {
  if (index < 0 || index >= options.length) return options;
  const next = options.slice();
  next[index] = value;
  return next;
}

export function addOption(options: string[], value = ""): string[] {
  return [...options, value];
}

export function removeOption(options: string[], index: number): string[] {
  if (index < 0 || index >= options.length) return options;
  return options.filter((_, i) => i !== index);
}

export function needsOptionEditor(kind: AnswerKind): boolean {
  return kind === "mc" || kind === "dropdown" || kind === "drivetrain";
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

export type DraftPublishKind = "unpublished" | "published" | "draft_changes";

export type DraftPublishStatus = {
  kind: DraftPublishKind;
  label: string;
  detail: string;
  version?: number;
};

function stableDefinitionFingerprint(definition: SchemaDefinition): string {
  return JSON.stringify({
    title: definition.title.trim(),
    fields: definition.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: Boolean(field.required),
      options: field.options ?? [],
      widget: field.widget ?? null,
      helpText: field.helpText ?? null,
    })),
  });
}

/** Compare the in-progress draft to the latest published schema for Soft-UI status. */
export function resolveDraftPublishStatus(args: {
  published: { version: number; definition: SchemaDefinition } | null | undefined;
  draftTitle: string;
  draftQuestions: DraftQuestion[];
}): DraftPublishStatus {
  const { published, draftTitle, draftQuestions } = args;
  if (!published) {
    return {
      kind: "unpublished",
      label: "Draft — not published",
      detail: "Scouts will not see this form until you publish a version for this season.",
    };
  }
  const draftDef = definitionFromDraft(draftTitle, draftQuestions);
  const dirty =
    stableDefinitionFingerprint(draftDef) !==
    stableDefinitionFingerprint(published.definition);
  if (dirty) {
    return {
      kind: "draft_changes",
      label: `Draft changes · published v${published.version}`,
      detail: "Edits are local until you publish. Live scouting keeps using the published version.",
      version: published.version,
    };
  }
  return {
    kind: "published",
    label: `Published v${published.version}`,
    detail: "This draft matches the live form scouts use after sync.",
    version: published.version,
  };
}

export type PostSaveNextStep = {
  id: string;
  href: string;
  label: string;
  detail: string;
};

/** After a successful local save, point scouts at real strategy / coverage surfaces (never DEMO). */
export function scoutingPostSaveNextSteps(
  orgId: string,
  options?: { eventKey?: string | null; entryType?: EntryType },
): PostSaveNextStep[] {
  const entryHint =
    options?.entryType === "pit"
      ? "Pit notes feed pick strategy once synced."
      : "Match notes feed alliance strategy once synced.";
  const coverage = withOrgHref("/scout-coverage-live", orgId);
  const lineup = withOrgHref("/scouting/lineup", orgId);
  const eventQs =
    options?.eventKey != null && options.eventKey !== ""
      ? `&eventKey=${encodeURIComponent(options.eventKey)}`
      : "";
  return [
    {
      id: "strategy",
      href: hubHref("/competition", "strategy", orgId),
      label: "Open strategy",
      detail: entryHint,
    },
    {
      id: "coverage",
      href: `${coverage}${eventQs}`,
      label: "Coverage live",
      detail: "See which matches and teams still need scouts.",
    },
    {
      id: "lineup",
      href: `${lineup}${eventQs}`,
      label: "Lineup & coverage",
      detail: "Assignments and gaps for this event.",
    },
  ];
}

/** Soft-UI related surfaces for Form builder (never DEMO fields). */
export const FORM_BUILDER_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
  { id: "offline", label: "Offline", kind: "path" as const, path: "/offline" },
] as const;

export type FormBuilderRelatedId = (typeof FORM_BUILDER_RELATED_LINKS)[number]["id"];

export type FormBuilderRelatedLink = {
  id: FormBuilderRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Coverage. */
export const FORM_BUILDER_RELATED_INCLUDE: FormBuilderRelatedId[] = [
  "scouting",
  "coverage",
];

/**
 * Soft-UI cross-links from Form builder → Scouting / Coverage.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function formBuilderRelatedLinks(
  orgId?: string | null,
  options?: { active?: FormBuilderRelatedId; include?: FormBuilderRelatedId[] },
): FormBuilderRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return FORM_BUILDER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type FormBuilderShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type FormBuilderNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type FormBuilderEmptyCopy = {
  kind: FormBuilderShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO fields. */
export type FormBuilderSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function formBuilderSetupSteps(orgId?: string | null): FormBuilderSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — published schemas stay org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Event Day Command sets the season year match and pit forms publish under.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live entry uses the published schema after sync — never DEMO fields.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Lineup gaps stay blank until real scout rows exist — never DEMO %.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
  ];
}

/** Classify Form builder Soft-UI shell — never invents DEMO fields. */
export function classifyFormBuilderShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  eventKey?: string | null;
  year?: number | null;
  hasPublishedSchema?: boolean;
}): FormBuilderShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || !input.eventKey || input.year == null) return "setup";
  if (!input.hasPublishedSchema) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO fields. */
export function formBuilderShellCopy(
  kind: FormBuilderShellKind,
  options?: { entryType?: EntryType },
): FormBuilderEmptyCopy {
  const typeLabel = options?.entryType === "pit" ? "pit" : "match";
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading form builder…",
        description:
          "Checking workspace, active event, and published schemas — never DEMO fields.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load form builder",
        description:
          "A network or server issue blocked schemas. Retry, or open Scouting / Coverage while it reloads — never invent DEMO fields.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace and event",
        description:
          "Form builder is org- and season-scoped. Pick a workspace and set an active TBA event so the publish year is known — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "Not published",
        title: `No ${typeLabel} form published yet`,
        description:
          `Draft questions stay local until you publish a ${typeLabel} schema. Scouts and Coverage stay blank until a real version exists — never DEMO fields.`,
      };
    default:
      return {
        kind: "ready",
        title: "Scouting form builder",
        description:
          "Edit required fields, preview, and publish versioned match or pit schemas — never DEMO fields.",
      };
  }
}

/**
 * Soft-UI next actions for Form builder empty/setup shells.
 * Points at Scouting / Coverage — never invents DEMO fields.
 */
export function formBuilderNextActions(input: {
  orgId?: string | null;
  shell: FormBuilderShellKind;
  eventKey?: string | null;
  canManageSchemas?: boolean;
  entryType?: EntryType;
}): FormBuilderNextAction[] {
  const orgId = input.orgId ?? null;
  const typeLabel = input.entryType === "pit" ? "pit" : "match";

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Form builder is org-scoped — choose a team before publishing schemas.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Live entry stays blank until a real schema publishes — never DEMO fields.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "coverage",
          label: "Open Coverage",
          detail: "Lineup gaps stay blank until real scout rows exist — never DEMO %.",
          href: withOrgHref("/scouting/lineup", null),
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Active event context lives on Event Day Command — never DEMO schedule.",
          href: hubHref("/competition", "command", null),
        },
      ];
    }
    return [
      {
        id: "command",
        label: "Set active event",
        detail: "Event Day Command sets the season year match and pit forms publish under.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Confirm entry stays honest when the event is unset — never DEMO fields.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Coverage stays honest when the event is unset — never DEMO %.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Strategy waits on the same real event context — never DEMO win rates.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry form builder",
        detail: "Reload real schemas — nothing is pre-seeded while this fails.",
        href: hubHref("/competition", "forms", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scouting stays available while schemas reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Coverage stays available while schemas reload.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "publish",
        label: input.canManageSchemas ? `Publish ${typeLabel} form` : "Ask an owner to publish",
        detail: input.canManageSchemas
          ? `Publish a real ${typeLabel} schema so Scouting and Coverage can use it — never DEMO fields.`
          : `Owners and admins publish ${typeLabel} forms — you can still preview the draft.`,
        href: hubHref("/competition", "forms", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Live entry stays blank until a published version exists.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Lineup gaps stay blank until real scout rows sync — never DEMO %.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  return [
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scouts pick up the published version on next sync.",
      href: hubHref("/competition", "scouting", orgId),
      primary: true,
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "See which matches and teams still need scouts.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Synced notes deepen pick explainability — never DEMO win rates.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "offline",
      label: "Open Offline",
      detail: "Confirm this device can cold-boot the published form when Wi-Fi drops.",
      href: withOrgHref("/offline", orgId),
    },
  ];
}

/** Soft-UI publish button label from draft vs published status. */
export function formBuilderPublishLabel(input: {
  busy?: boolean;
  entryType: EntryType;
  status: DraftPublishStatus;
}): string {
  if (input.busy) return "Publishing…";
  const typeLabel = input.entryType === "pit" ? "pit" : "match";
  if (input.status.kind === "unpublished") return `Publish ${typeLabel} form`;
  if (input.status.kind === "draft_changes") return `Publish ${typeLabel} changes`;
  return `Republish ${typeLabel} form`;
}

/**
 * Soft-UI publish clarity — why Publish is blocked right now.
 * Returns null when the draft is ready to POST.
 */
export function formBuilderPublishBlockedReason(input: {
  canManageSchemas: boolean;
  year: number | null | undefined;
  eventKey?: string | null;
  validation: FormBuilderValidation;
  acknowledgeBudget: boolean;
}): string | null {
  if (!input.canManageSchemas) {
    return "Owner or admin role is required to publish forms.";
  }
  if (!input.eventKey || input.year == null) {
    return "Set an active event so the season year is known before publishing.";
  }
  if (!input.validation.ok) {
    return input.validation.errors[0] ?? "Fix the form before publishing.";
  }
  if (input.validation.budget.status === "over_budget" && !input.acknowledgeBudget) {
    return "This form is over the field budget — acknowledge to publish anyway.";
  }
  return null;
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
