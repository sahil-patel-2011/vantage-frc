/**
 * The content model of a team lesson, validated, stripped and graded. Pure: no database, no
 * React, safe in the browser (the editor uses the publish checks and the pass rule to explain
 * them) and on the server (the API validates every write and grades every submission).
 *
 * Drafts are saved while they are being typed, so `parseLessonBody` is strict about SHAPE —
 * types, lengths, counts, ids, unknown fields — and lenient about COMPLETENESS (an empty step
 * title, a choice question whose options are still blank, a number question with no answer
 * yet). `lessonPublishProblems` is where completeness is required, in plain sentences.
 */

import {
  LESSON_LIMITS,
  type LessonBody,
  type LessonMeta,
  type LessonStep,
  type NumberQuestion,
  type PracticeAnswers,
  type PracticeQuestion,
  type PracticeResult,
  type PublicLessonBody,
  type PublicQuestion,
  type QuestionResult,
} from "./types";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const ID = /^[A-Za-z0-9_-]{1,40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class BodyError extends Error {}

function fail(message: string): never {
  throw new BodyError(message);
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[], where: string) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(`${where} has a field Vantage does not know (${key.slice(0, 40)}).`);
  }
}

function text(value: unknown, max: number, where: string): string {
  if (typeof value !== "string") fail(`${where} must be text.`);
  if (value.length > max) fail(`${where} is longer than ${max} characters.`);
  return value;
}

function optionalText(value: unknown, max: number, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, max, where);
}

function id(value: unknown, seen: Set<string>, where: string): string {
  if (typeof value !== "string" || !ID.test(value)) fail(`${where} has an invalid id.`);
  if (seen.has(value)) fail(`${where} repeats an id used earlier.`);
  seen.add(value);
  return value;
}

function finite(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${where} must be a number.`);
  if (Math.abs(value) > LESSON_LIMITS.numberMagnitude) fail(`${where} is too large.`);
  return value;
}

function parseStep(value: unknown, index: number, seen: Set<string>): LessonStep {
  const where = `Step ${index + 1}`;
  if (!isRecord(value)) fail(`${where} must be an object.`);
  onlyKeys(value, ["id", "title", "text", "example", "whenToUse"], where);
  const step: LessonStep = {
    id: id(value.id, seen, where),
    title: text(value.title, LESSON_LIMITS.stepTitle, `${where} title`),
    text: text(value.text, LESSON_LIMITS.stepText, `${where} text`),
  };
  const example = optionalText(value.example, LESSON_LIMITS.stepExample, `${where} example`);
  const whenToUse = optionalText(value.whenToUse, LESSON_LIMITS.stepWhenToUse, `${where} "When to use it"`);
  if (example !== undefined) step.example = example;
  if (whenToUse !== undefined) step.whenToUse = whenToUse;
  return step;
}

function parseQuestion(value: unknown, index: number, seen: Set<string>): PracticeQuestion {
  const where = `Question ${index + 1}`;
  if (!isRecord(value)) fail(`${where} must be an object.`);
  const questionId = id(value.id, seen, where);
  const prompt = text(value.prompt, LESSON_LIMITS.prompt, `${where} prompt`);
  if (value.kind === "choice") {
    onlyKeys(value, ["id", "kind", "prompt", "options", "answer"], where);
    if (!Array.isArray(value.options)) fail(`${where} options must be a list.`);
    if (value.options.length < LESSON_LIMITS.optionsMin || value.options.length > LESSON_LIMITS.optionsMax) {
      fail(`${where} needs ${LESSON_LIMITS.optionsMin} to ${LESSON_LIMITS.optionsMax} options.`);
    }
    const options = value.options.map((option, at) => text(option, LESSON_LIMITS.option, `${where} option ${at + 1}`));
    const answer = value.answer;
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      fail(`${where} must mark one of its options as the answer.`);
    }
    return { id: questionId, kind: "choice", prompt, options, answer };
  }
  if (value.kind === "number") {
    onlyKeys(value, ["id", "kind", "prompt", "answer", "tolerance", "unit"], where);
    const answer = value.answer === null ? null : finite(value.answer, `${where} answer`);
    const tolerance = value.tolerance === undefined ? 0 : finite(value.tolerance, `${where} tolerance`);
    if (tolerance < 0) fail(`${where} tolerance cannot be negative.`);
    const question: NumberQuestion = { id: questionId, kind: "number", prompt, answer, tolerance };
    const unit = optionalText(value.unit, LESSON_LIMITS.unit, `${where} unit`);
    if (unit !== undefined) question.unit = unit;
    return question;
  }
  if (value.kind === "text") {
    onlyKeys(value, ["id", "kind", "prompt", "accepted"], where);
    if (!Array.isArray(value.accepted)) fail(`${where} accepted answers must be a list.`);
    if (value.accepted.length > LESSON_LIMITS.accepted) fail(`${where} can have at most ${LESSON_LIMITS.accepted} accepted answers.`);
    const accepted = value.accepted.map((entry, at) => text(entry, LESSON_LIMITS.acceptedText, `${where} accepted answer ${at + 1}`));
    return { id: questionId, kind: "text", prompt, accepted };
  }
  fail(`${where} must be multiple choice, a number or a short answer.`);
}

/**
 * Strict structural validation of a lesson body. Unknown fields are refused (never silently
 * dropped), every string is length-capped, ids are unique, and there are at most 40 steps and
 * 20 questions. Incomplete drafts pass; see `lessonPublishProblems`.
 */
export function parseLessonBody(input: unknown): ParseResult<LessonBody> {
  try {
    if (!isRecord(input)) fail("The lesson content must be an object.");
    onlyKeys(input, ["steps", "practice"], "The lesson");
    const steps = input.steps ?? [];
    const practice = input.practice ?? [];
    if (!Array.isArray(steps)) fail("Steps must be a list.");
    if (!Array.isArray(practice)) fail("Practice questions must be a list.");
    if (steps.length > LESSON_LIMITS.steps) fail(`A lesson can have at most ${LESSON_LIMITS.steps} steps.`);
    if (practice.length > LESSON_LIMITS.questions) fail(`A lesson can have at most ${LESSON_LIMITS.questions} practice questions.`);
    const stepIds = new Set<string>();
    const questionIds = new Set<string>();
    return {
      ok: true,
      value: {
        steps: steps.map((step, index) => parseStep(step, index, stepIds)),
        practice: practice.map((question, index) => parseQuestion(question, index, questionIds)),
      },
    };
  } catch (error) {
    if (error instanceof BodyError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Title, summary, audience and minutes from an untrusted request. Absent fields stay absent. */
export function parseLessonMeta(input: Record<string, unknown>): ParseResult<Partial<LessonMeta>> {
  const meta: Partial<LessonMeta> = {};
  if (input.title !== undefined) {
    if (typeof input.title !== "string") return { ok: false, error: "The title must be text." };
    if (input.title.length > LESSON_LIMITS.title) return { ok: false, error: `Keep the title under ${LESSON_LIMITS.title} characters.` };
    meta.title = input.title;
  }
  if (input.summary !== undefined) {
    if (typeof input.summary !== "string") return { ok: false, error: "The summary must be text." };
    if (input.summary.length > LESSON_LIMITS.summary) return { ok: false, error: `Keep the summary under ${LESSON_LIMITS.summary} characters.` };
    meta.summary = input.summary;
  }
  if (input.audience !== undefined) {
    if (typeof input.audience !== "string") return { ok: false, error: "Who it is for must be text." };
    if (input.audience.length > LESSON_LIMITS.audience) return { ok: false, error: `Keep "who it is for" under ${LESSON_LIMITS.audience} characters.` };
    meta.audience = input.audience;
  }
  if (input.minutes !== undefined) {
    if (input.minutes === null) meta.minutes = null;
    else if (
      typeof input.minutes !== "number" ||
      !Number.isInteger(input.minutes) ||
      input.minutes < LESSON_LIMITS.minutesMin ||
      input.minutes > LESSON_LIMITS.minutesMax
    ) {
      return { ok: false, error: `Minutes must be a whole number from ${LESSON_LIMITS.minutesMin} to ${LESSON_LIMITS.minutesMax}.` };
    } else meta.minutes = input.minutes;
  }
  return { ok: true, value: meta };
}

/** Case, accents-as-typed, and spacing do not matter for a short answer. */
export function normalizeShortAnswer(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** A question a student can be graded on: everything it needs is filled in. */
export function isGradable(question: PracticeQuestion): boolean {
  if (!question.prompt.trim()) return false;
  if (question.kind === "choice") {
    const options = question.options.map((option) => option.trim());
    return (
      options.every(Boolean) &&
      new Set(options.map((option) => option.toLowerCase())).size === options.length &&
      question.answer >= 0 &&
      question.answer < options.length
    );
  }
  if (question.kind === "number") return question.answer !== null && Number.isFinite(question.answer);
  return question.accepted.some((entry) => normalizeShortAnswer(entry).length > 0);
}

/**
 * The body for someone who cannot edit the lesson: steps as written, and only the questions
 * that can be graded, without their answers, accepted answers or tolerances.
 */
export function publicLessonBody(body: LessonBody): PublicLessonBody {
  return {
    steps: body.steps.map((step) => ({ ...step })),
    practice: body.practice.filter(isGradable).map((question): PublicQuestion => {
      if (question.kind === "choice") {
        return { id: question.id, kind: "choice", prompt: question.prompt, options: [...question.options] };
      }
      if (question.kind === "number") {
        return question.unit
          ? { id: question.id, kind: "number", prompt: question.prompt, unit: question.unit }
          : { id: question.id, kind: "number", prompt: question.prompt };
      }
      return { id: question.id, kind: "text", prompt: question.prompt };
    }),
  };
}

/** Correct answers needed to pass `total` questions: all of them, or 80% when there are more than 4. */
export function passMark(total: number): number {
  if (total <= 0) return 0;
  return total > 4 ? Math.ceil(total * 0.8 - 1e-9) : total;
}

/** The pass rule in the words the practice section shows. */
export function passRuleSentence(total: number): string {
  if (total <= 0) return "This lesson has no practice questions yet.";
  if (total <= 4) return `Get all ${total} right to pass.`;
  return `Get at least ${passMark(total)} of ${total} right to pass (80%). With 4 questions or fewer, every answer has to be right.`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(10)));
}

/** Reads a typed number: "12", " 12.5 ", "1,250", "12 in" when the unit is "in". */
export function readNumberAnswer(value: number | string, unit?: string): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = value.trim().slice(0, LESSON_LIMITS.answerText);
  if (unit && raw.toLowerCase().endsWith(unit.trim().toLowerCase())) raw = raw.slice(0, raw.length - unit.trim().length).trim();
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) raw = raw.replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function gradeOne(question: PracticeQuestion, given: number | string | undefined): QuestionResult {
  const blank = given === undefined || (typeof given === "string" && !given.trim());
  if (blank) return { id: question.id, correct: false, feedback: "No answer given." };
  if (question.kind === "choice") {
    const index = typeof given === "number" ? given : Number(given);
    if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
      return { id: question.id, correct: false, feedback: "Choose one of the options." };
    }
    return index === question.answer
      ? { id: question.id, correct: true, feedback: "Correct." }
      : { id: question.id, correct: false, feedback: "Not this one. Look back at the steps and try again." };
  }
  if (question.kind === "number") {
    const value = readNumberAnswer(given, question.unit);
    if (value === null) return { id: question.id, correct: false, feedback: "Enter a number." };
    const answer = question.answer ?? Number.NaN;
    const slack = question.tolerance + 1e-9 * Math.max(1, Math.abs(answer));
    if (Math.abs(value - answer) <= slack) {
      const within = question.tolerance > 0 ? ` (within ±${formatNumber(question.tolerance)}${question.unit ? ` ${question.unit}` : ""})` : "";
      return { id: question.id, correct: true, feedback: `Correct${within}.` };
    }
    return { id: question.id, correct: false, feedback: value > answer ? "Too high." : "Too low." };
  }
  const typed = normalizeShortAnswer(String(given).slice(0, LESSON_LIMITS.answerText));
  const accepted = new Set(question.accepted.map(normalizeShortAnswer).filter(Boolean));
  return accepted.has(typed)
    ? { id: question.id, correct: true, feedback: "Correct." }
    : { id: question.id, correct: false, feedback: "Not one of the accepted answers. Check the spelling and try again." };
}

/**
 * Grades a submission against the full body. Only gradable questions count (the same set
 * `publicLessonBody` shows). Server-only in practice: the browser never has the answers.
 */
export function gradePractice(body: LessonBody, answers: PracticeAnswers): PracticeResult {
  const questions = body.practice.filter(isGradable);
  const results = questions.map((question) =>
    gradeOne(question, Object.prototype.hasOwnProperty.call(answers, question.id) ? answers[question.id] : undefined),
  );
  const score = results.filter((result) => result.correct).length;
  const total = results.length;
  const mark = passMark(total);
  return { results, score, total, passed: total > 0 && score >= mark, passMark: mark };
}

/**
 * Answers from an untrusted request: an object of question id → number or short text. Values
 * for unknown questions are dropped; text is capped. Returns null when it is not that shape.
 */
export function parsePracticeAnswers(input: unknown, body: LessonBody): PracticeAnswers | null {
  if (!isRecord(input)) return null;
  const known = new Set(body.practice.map((question) => question.id));
  const answers: PracticeAnswers = {};
  for (const [key, value] of Object.entries(input)) {
    if (!known.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) answers[key] = value;
    else if (typeof value === "string") answers[key] = value.slice(0, LESSON_LIMITS.answerText);
    else if (value !== null && value !== undefined) return null;
  }
  return answers;
}

/**
 * Which field a publish problem is about, so the editor can link to it and mark it:
 * `title`, `steps` (none yet), `pdf`, `step:<id>:title|text`, or
 * `question:<id>:prompt|options|answer|accepted`.
 */
export type LessonPublishIssue = { message: string; field: string };

/**
 * What still has to be filled in before a lesson can be published, one entry per missing
 * thing, in page order. The editor lists these next to Publish (and does not ask "Publish this
 * lesson?" while any remain); the publish action refuses with the same sentences.
 */
export function lessonPublishIssues(
  meta: Pick<LessonMeta, "title">,
  body: LessonBody,
  options: { source: "editor" | "pdf"; hasPdf: boolean },
): LessonPublishIssue[] {
  const issues: LessonPublishIssue[] = [];
  const add = (message: string, field: string) => issues.push({ message, field });
  if (!meta.title.trim()) add("Give the lesson a title.", "title");
  if (options.source === "pdf") {
    if (!options.hasPdf) add("Upload the PDF, or switch back to writing steps.", "pdf");
  } else {
    if (body.steps.length === 0) add("Add at least one step.", "steps");
    body.steps.forEach((step, index) => {
      if (!step.title.trim()) add(`Step ${index + 1} needs a title.`, `step:${step.id}:title`);
      if (!step.text.trim()) add(`Step ${index + 1} has no text yet.`, `step:${step.id}:text`);
    });
  }
  body.practice.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    const field = (part: string) => `question:${question.id}:${part}`;
    if (!question.prompt.trim()) add(`${label} needs a question.`, field("prompt"));
    if (question.kind === "choice") {
      const options = question.options.map((option) => option.trim());
      if (options.some((option) => !option)) add(`${label} has an empty option.`, field("options"));
      else if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
        add(`${label} has two options that say the same thing.`, field("options"));
      }
    } else if (question.kind === "number") {
      if (question.answer === null) add(`${label} has no answer. Enter the correct number.`, field("answer"));
    } else if (!question.accepted.some((entry) => entry.trim())) {
      add(`${label} has no answer. Add at least one accepted answer.`, field("accepted"));
    }
  });
  return issues;
}

/** The same list as plain sentences. An empty list means the lesson can be published. */
export function lessonPublishProblems(
  meta: Pick<LessonMeta, "title">,
  body: LessonBody,
  options: { source: "editor" | "pdf"; hasPdf: boolean },
): string[] {
  return lessonPublishIssues(meta, body, options).map((issue) => issue.message);
}

export const EMPTY_LESSON_BODY: LessonBody = { steps: [], practice: [] };

/** A short random id for a new step or question (unique enough inside one lesson). */
export function newContentId(prefix: "s" | "q"): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${random}`;
}
