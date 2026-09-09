/**
 * Team Forms — question kinds and shared shapes.
 *
 * Deliberately kept free of database and React imports so both the API route
 * and the client bundle can use it. Barrel imports that drag Node built-ins
 * into a client component have broken the production build here before.
 */

export const QUESTION_KINDS = [
  "short_text",
  "long_text",
  "number",
  "single_select",
  "multi_select",
  "scale",
  "yes_no",
  "date",
  "email",
  "phone",
  "counter",
] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const FORM_PURPOSES = [
  "general",
  "intake",
  "tryout",
  "mentor",
  "parent",
  "dues",
  "travel",
  "safety",
  "feedback",
  "scouting",
  "award",
] as const;

export type FormPurpose = (typeof FORM_PURPOSES)[number];
export type FormStatus = "draft" | "open" | "closed";
export type FormAudience = "members" | "link";

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  short_text: "Short answer",
  long_text: "Paragraph",
  number: "Number",
  single_select: "Choose one",
  multi_select: "Choose many",
  scale: "Rating scale",
  yes_no: "Yes / No",
  date: "Date",
  email: "Email",
  phone: "Phone",
  counter: "Counter",
};

export const PURPOSE_LABELS: Record<FormPurpose, string> = {
  general: "General",
  intake: "New member intake",
  tryout: "Tryout / driver selection",
  mentor: "Mentor sign-up",
  parent: "Parent / guardian",
  dues: "Dues & payments",
  travel: "Travel & logistics",
  safety: "Safety & training",
  feedback: "Feedback & retro",
  scouting: "Scouting",
  award: "Award submission",
};

/** Kinds whose answers are genuinely numeric and can be averaged. */
export const NUMERIC_KINDS: readonly QuestionKind[] = ["number", "scale", "counter"];

/** Kinds that carry a fixed option list. */
export const CHOICE_KINDS: readonly QuestionKind[] = ["single_select", "multi_select", "yes_no"];

export type QuestionConfig = {
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
};

export type FormQuestion = {
  id: string;
  position: number;
  kind: QuestionKind;
  label: string;
  help: string;
  required: boolean;
  config: QuestionConfig;
};

export type FormSummary = {
  id: string;
  title: string;
  description: string;
  purpose: FormPurpose;
  status: FormStatus;
  audience: FormAudience;
  shareToken: string | null;
  closesAt: string | null;
  questionCount: number;
  responseCount: number;
  assignedCount: number;
  createdAt: string;
};

export function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === "string" && (QUESTION_KINDS as readonly string[]).includes(value);
}

export function isFormPurpose(value: unknown): value is FormPurpose {
  return typeof value === "string" && (FORM_PURPOSES as readonly string[]).includes(value);
}

/** Options a choice question offers, with yes/no supplying its own. */
export function optionsFor(question: Pick<FormQuestion, "kind" | "config">): string[] {
  if (question.kind === "yes_no") return ["Yes", "No"];
  return Array.isArray(question.config.options) ? question.config.options : [];
}

/**
 * The numeric value of an answer, or null when it is not a number.
 *
 * Null and zero are different answers and must stay different: a scale answer
 * of 0 is a real rating, while an unparseable one has to be excluded from an
 * average rather than counted as zero. Returning 0 for "no answer" is how a
 * readiness metric ends up flattering a team that entered nothing.
 */
export function numericValue(kind: QuestionKind, raw: string): number | null {
  if (!NUMERIC_KINDS.includes(kind)) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function defaultConfigFor(kind: QuestionKind): QuestionConfig {
  switch (kind) {
    case "single_select":
    case "multi_select":
      return { options: ["Option 1", "Option 2"] };
    case "scale":
      return { min: 1, max: 5, step: 1 };
    case "counter":
      return { min: 0, step: 1 };
    default:
      return {};
  }
}

/**
 * Starter questions per purpose.
 *
 * These are question *prompts* for a blank form, not data. Nothing here is ever
 * shown as a result or counted as a response — the results view stays empty
 * until real people answer.
 */
export const STARTER_QUESTIONS: Partial<Record<FormPurpose, Array<Pick<FormQuestion, "kind" | "label" | "required"> & { config?: QuestionConfig }>>> = {
  intake: [
    { kind: "short_text", label: "Student name", required: true },
    { kind: "email", label: "Student email", required: true },
    { kind: "short_text", label: "Grade / year", required: true },
    { kind: "short_text", label: "Parent or guardian name", required: true },
    { kind: "phone", label: "Parent or guardian phone", required: true },
    {
      kind: "multi_select",
      label: "Which subteams interest you?",
      required: false,
      config: { options: ["Mechanical", "Electrical", "Programming", "CAD", "Scouting", "Business", "Media", "Safety"] },
    },
    { kind: "long_text", label: "Anything you have built or programmed before?", required: false },
  ],
  tryout: [
    { kind: "short_text", label: "Student name", required: true },
    {
      kind: "single_select",
      label: "Position you are trying out for",
      required: true,
      config: { options: ["Driver", "Operator", "Human player", "Pit crew", "Drive coach"] },
    },
    { kind: "scale", label: "Cycles completed in the practice run", required: false, config: { min: 0, max: 20, step: 1 } },
    { kind: "long_text", label: "What went wrong and how would you fix it?", required: false },
  ],
  mentor: [
    { kind: "short_text", label: "Name", required: true },
    { kind: "email", label: "Email", required: true },
    { kind: "phone", label: "Phone", required: false },
    {
      kind: "multi_select",
      label: "Where can you help?",
      required: true,
      config: { options: ["Mechanical", "Electrical", "Programming", "CAD", "Business", "Safety", "Travel & logistics", "Fundraising"] },
    },
    {
      kind: "single_select",
      label: "Background check / youth protection status",
      required: true,
      config: { options: ["Complete", "In progress", "Not started"] },
    },
    { kind: "long_text", label: "Availability during build season", required: false },
  ],
  dues: [
    { kind: "short_text", label: "Student name", required: true },
    {
      kind: "single_select",
      label: "Payment status",
      required: true,
      config: { options: ["Paid in full", "Partial payment", "Requesting assistance", "Not yet paid"] },
    },
    { kind: "number", label: "Amount paid", required: false },
    { kind: "long_text", label: "Notes for the treasurer", required: false },
  ],
  travel: [
    { kind: "short_text", label: "Student name", required: true },
    { kind: "yes_no", label: "Travelling with the team to this event?", required: true },
    { kind: "short_text", label: "Emergency contact name", required: true },
    { kind: "phone", label: "Emergency contact phone", required: true },
    { kind: "long_text", label: "Dietary needs, allergies, or medication", required: false },
  ],
  safety: [
    { kind: "short_text", label: "Name", required: true },
    { kind: "yes_no", label: "Completed shop safety training?", required: true },
    { kind: "date", label: "Training date", required: false },
    { kind: "yes_no", label: "Has safety glasses", required: true },
  ],
  feedback: [
    { kind: "scale", label: "How did this week go?", required: true, config: { min: 1, max: 5, step: 1 } },
    { kind: "long_text", label: "What went well?", required: false },
    { kind: "long_text", label: "What should we change next week?", required: false },
  ],
};
