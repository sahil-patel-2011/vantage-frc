import { describe, expect, it } from "vitest";
import {
  gradePractice,
  isGradable,
  lessonPublishIssues,
  lessonPublishProblems,
  normalizeShortAnswer,
  parseLessonBody,
  parseLessonMeta,
  parsePracticeAnswers,
  passMark,
  passRuleSentence,
  publicLessonBody,
  readNumberAnswer,
} from "./body";
import { LESSON_LIMITS, type LessonBody } from "./types";

const lesson: LessonBody = {
  steps: [
    { id: "s-1", title: "Open the robot project", text: "Use **WPILib VS Code**.", whenToUse: "Every session", example: "`./gradlew build`" },
    { id: "s-2", title: "Deploy", text: "Press Shift+F5." },
  ],
  practice: [
    { id: "q-1", kind: "choice", prompt: "Which key deploys?", options: ["F5", "Shift+F5", "Ctrl+S"], answer: 1 },
    { id: "q-2", kind: "number", prompt: "Battery voltage before a match?", answer: 12.5, tolerance: 0.3, unit: "V" },
    { id: "q-3", kind: "text", prompt: "What tool builds the code?", accepted: ["Gradle", "gradlew"] },
  ],
};

describe("parseLessonBody", () => {
  it("accepts a complete lesson and returns only known fields", () => {
    const parsed = parseLessonBody(JSON.parse(JSON.stringify(lesson)));
    expect(parsed).toEqual({ ok: true, value: lesson });
  });

  it("accepts an unfinished draft so autosave never drops typed text", () => {
    const draft = {
      steps: [{ id: "s-1", title: "", text: "half a sent" }],
      practice: [
        { id: "q-1", kind: "choice", prompt: "", options: ["", ""], answer: 0 },
        { id: "q-2", kind: "number", prompt: "How many?", answer: null, tolerance: 0 },
        { id: "q-3", kind: "text", prompt: "Name it", accepted: [] },
      ],
    };
    expect(parseLessonBody(draft).ok).toBe(true);
    expect(parseLessonBody({}).ok).toBe(true);
  });

  it("refuses unknown fields instead of silently dropping them", () => {
    expect(parseLessonBody({ ...lesson, extra: true })).toEqual({ ok: false, error: expect.stringContaining("extra") });
    const step = { ...lesson.steps[0], html: "<b>x</b>" };
    expect(parseLessonBody({ steps: [step], practice: [] }).ok).toBe(false);
  });

  it("enforces the limits: 40 steps, 20 questions, text lengths and 2 to 6 options", () => {
    const steps = Array.from({ length: 41 }, (_, i) => ({ id: `s-${i}`, title: "t", text: "x" }));
    expect(parseLessonBody({ steps, practice: [] })).toEqual({ ok: false, error: expect.stringContaining("40 steps") });
    const practice = Array.from({ length: 21 }, (_, i) => ({ id: `q-${i}`, kind: "text", prompt: "p", accepted: ["a"] }));
    expect(parseLessonBody({ steps: [], practice })).toEqual({ ok: false, error: expect.stringContaining("20 practice") });
    const long = { id: "s-1", title: "t", text: "x".repeat(LESSON_LIMITS.stepText + 1) };
    expect(parseLessonBody({ steps: [long], practice: [] }).ok).toBe(false);
    const exact = { id: "s-1", title: "t", text: "x".repeat(LESSON_LIMITS.stepText) };
    expect(parseLessonBody({ steps: [exact], practice: [] }).ok).toBe(true);
    const one = { id: "q", kind: "choice", prompt: "p", options: ["a"], answer: 0 };
    const seven = { ...one, options: ["a", "b", "c", "d", "e", "f", "g"] };
    expect(parseLessonBody({ steps: [], practice: [one] }).ok).toBe(false);
    expect(parseLessonBody({ steps: [], practice: [seven] }).ok).toBe(false);
  });

  it("refuses bad ids, repeated ids, wrong kinds and out-of-range answers", () => {
    const step = (id: unknown) => ({ steps: [{ id, title: "t", text: "x" }], practice: [] });
    expect(parseLessonBody(step("has space")).ok).toBe(false);
    expect(parseLessonBody(step("x".repeat(41))).ok).toBe(false);
    expect(parseLessonBody(step(7)).ok).toBe(false);
    expect(parseLessonBody({ steps: [lesson.steps[0], lesson.steps[0]], practice: [] }).ok).toBe(false);
    const q = (extra: Record<string, unknown>) => ({ steps: [], practice: [{ id: "q", prompt: "p", ...extra }] });
    expect(parseLessonBody(q({ kind: "essay" })).ok).toBe(false);
    expect(parseLessonBody(q({ kind: "choice", options: ["a", "b"], answer: 2 })).ok).toBe(false);
    expect(parseLessonBody(q({ kind: "choice", options: ["a", "b"], answer: 0.5 })).ok).toBe(false);
    expect(parseLessonBody(q({ kind: "number", answer: Number.NaN, tolerance: 0 })).ok).toBe(false);
    expect(parseLessonBody(q({ kind: "number", answer: 1, tolerance: -1 })).ok).toBe(false);
    expect(parseLessonBody(q({ kind: "number", answer: "12", tolerance: 0 })).ok).toBe(false);
    expect(parseLessonBody(q({ kind: "text", accepted: "Gradle" })).ok).toBe(false);
    expect(parseLessonBody(null).ok).toBe(false);
    expect(parseLessonBody([]).ok).toBe(false);
  });
});

describe("parseLessonMeta", () => {
  it("keeps absent fields absent and checks the rest", () => {
    expect(parseLessonMeta({})).toEqual({ ok: true, value: {} });
    expect(parseLessonMeta({ title: "Deploying", minutes: 20, audience: "Rookies", summary: "" })).toEqual({
      ok: true,
      value: { title: "Deploying", minutes: 20, audience: "Rookies", summary: "" },
    });
    expect(parseLessonMeta({ minutes: null })).toEqual({ ok: true, value: { minutes: null } });
    expect(parseLessonMeta({ minutes: 0 }).ok).toBe(false);
    expect(parseLessonMeta({ minutes: 601 }).ok).toBe(false);
    expect(parseLessonMeta({ minutes: 2.5 }).ok).toBe(false);
    expect(parseLessonMeta({ title: "x".repeat(161) }).ok).toBe(false);
    expect(parseLessonMeta({ summary: 5 }).ok).toBe(false);
  });
});

describe("publicLessonBody", () => {
  it("strips answers, accepted answers and tolerances", () => {
    const visible = publicLessonBody(lesson);
    expect(visible.steps).toEqual(lesson.steps);
    expect(visible.practice).toEqual([
      { id: "q-1", kind: "choice", prompt: "Which key deploys?", options: ["F5", "Shift+F5", "Ctrl+S"] },
      { id: "q-2", kind: "number", prompt: "Battery voltage before a match?", unit: "V" },
      { id: "q-3", kind: "text", prompt: "What tool builds the code?" },
    ]);
    const serialized = JSON.stringify(visible);
    expect(serialized).not.toContain("answer");
    expect(serialized).not.toContain("accepted");
    expect(serialized).not.toContain("tolerance");
    expect(JSON.stringify(visible.practice)).not.toMatch(/gradle|12\.5|0\.3/i);
  });

  it("leaves out questions that can't be graded yet", () => {
    const unfinished: LessonBody = {
      steps: [],
      practice: [
        { id: "a", kind: "number", prompt: "How many?", answer: null, tolerance: 0 },
        { id: "b", kind: "text", prompt: "Name it", accepted: ["  "] },
        { id: "c", kind: "choice", prompt: "Pick", options: ["Same", "same"], answer: 0 },
        { id: "d", kind: "choice", prompt: "", options: ["x", "y"], answer: 0 },
        { id: "e", kind: "text", prompt: "Ready", accepted: ["yes"] },
      ],
    };
    expect(publicLessonBody(unfinished).practice.map((q) => q.id)).toEqual(["e"]);
    expect(unfinished.practice.map(isGradable)).toEqual([false, false, false, false, true]);
  });
});

describe("gradePractice", () => {
  it("grades every kind and explains each answer", () => {
    const result = gradePractice(lesson, { "q-1": 1, "q-2": "12.7 V", "q-3": "  GRADLE " });
    expect(result).toMatchObject({ score: 3, total: 3, passed: true, passMark: 3 });
    expect(result.results.map((r) => r.feedback)).toEqual(["Correct.", "Correct (within ±0.3 V).", "Correct."]);
  });

  it("says too high, too low, not this one, and no answer", () => {
    const high = gradePractice(lesson, { "q-1": 0, "q-2": 13, "q-3": "make" });
    expect(high.results.map((r) => r.correct)).toEqual([false, false, false]);
    expect(high.results[1]!.feedback).toBe("Too high.");
    expect(high.results[0]!.feedback).toMatch(/Not this one/);
    expect(high.results[2]!.feedback).toMatch(/accepted answers/);
    expect(gradePractice(lesson, { "q-2": "11" }).results[1]!.feedback).toBe("Too low.");
    const blank = gradePractice(lesson, {});
    expect(blank.results.every((r) => r.feedback === "No answer given.")).toBe(true);
    expect(blank).toMatchObject({ score: 0, total: 3, passed: false });
    expect(gradePractice(lesson, { "q-2": "twelve" }).results[1]!.feedback).toBe("Enter a number.");
    expect(gradePractice(lesson, { "q-1": 9 }).results[0]!.feedback).toBe("Choose one of the options.");
  });

  it("needs every answer right with 4 questions or fewer", () => {
    const two = gradePractice(lesson, { "q-1": 1, "q-2": 12.5 });
    expect(two).toMatchObject({ score: 2, total: 3, passed: false, passMark: 3 });
  });

  it("passes at 80% with more than 4 questions", () => {
    const practice = Array.from({ length: 5 }, (_, i) => ({ id: `q-${i}`, kind: "text" as const, prompt: `Q${i}`, accepted: ["ok"] }));
    const body: LessonBody = { steps: [], practice };
    const four = Object.fromEntries(practice.slice(0, 4).map((q) => [q.id, "ok"]));
    const three = Object.fromEntries(practice.slice(0, 3).map((q) => [q.id, "ok"]));
    expect(gradePractice(body, four)).toMatchObject({ score: 4, total: 5, passed: true, passMark: 4 });
    expect(gradePractice(body, three)).toMatchObject({ score: 3, total: 5, passed: false });
  });

  it("only counts gradable questions and never passes an empty practice", () => {
    const body: LessonBody = {
      steps: [],
      practice: [
        { id: "a", kind: "number", prompt: "How many?", answer: null, tolerance: 0 },
        { id: "b", kind: "text", prompt: "Ready", accepted: ["yes"] },
      ],
    };
    expect(gradePractice(body, { a: 3, b: "yes" })).toMatchObject({ score: 1, total: 1, passed: true });
    expect(gradePractice({ steps: [], practice: [] }, {})).toMatchObject({ score: 0, total: 0, passed: false });
  });

  it("matches a number exactly when there is no tolerance", () => {
    const body: LessonBody = { steps: [], practice: [{ id: "n", kind: "number", prompt: "0.1 + 0.2", answer: 0.3, tolerance: 0 }] };
    expect(gradePractice(body, { n: 0.1 + 0.2 }).passed).toBe(true);
    expect(gradePractice(body, { n: "0.31" }).passed).toBe(false);
  });
});

describe("answers and numbers", () => {
  it("reads typed numbers with units, thousands and signs", () => {
    expect(readNumberAnswer("12", "in")).toBe(12);
    expect(readNumberAnswer(" 12.5 in ", "in")).toBe(12.5);
    expect(readNumberAnswer("1,250")).toBe(1250);
    expect(readNumberAnswer("-.5")).toBe(-0.5);
    expect(readNumberAnswer("1e3")).toBe(1000);
    expect(readNumberAnswer("12 ft", "in")).toBeNull();
    expect(readNumberAnswer("")).toBeNull();
    expect(readNumberAnswer(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("normalizes short answers for case and spacing", () => {
    expect(normalizeShortAnswer("  Swerve   Drive ")).toBe("swerve drive");
  });

  it("keeps only known questions' answers and refuses other shapes", () => {
    expect(parsePracticeAnswers({ "q-1": 1, "q-3": "x".repeat(500), nope: 3 }, lesson)).toEqual({ "q-1": 1, "q-3": "x".repeat(200) });
    expect(parsePracticeAnswers({ "q-1": { evil: true } }, lesson)).toBeNull();
    expect(parsePracticeAnswers("1", lesson)).toBeNull();
  });
});

describe("pass rule", () => {
  it("is all-correct up to 4 questions, then 80% rounded up", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 10, 20].map(passMark)).toEqual([0, 1, 2, 3, 4, 4, 5, 6, 8, 16]);
    expect(passRuleSentence(3)).toBe("Get all 3 right to pass.");
    expect(passRuleSentence(10)).toMatch(/at least 8 of 10/);
    expect(passRuleSentence(0)).toMatch(/no practice questions/);
  });
});

describe("lessonPublishProblems", () => {
  it("is empty for a finished lesson", () => {
    expect(lessonPublishProblems({ title: "Deploying" }, lesson, { source: "editor", hasPdf: false })).toEqual([]);
  });

  it("names everything still missing, in order", () => {
    const body: LessonBody = {
      steps: [{ id: "s", title: "", text: " " }],
      practice: [
        { id: "a", kind: "choice", prompt: "", options: ["x", ""], answer: 0 },
        { id: "b", kind: "number", prompt: "n", answer: null, tolerance: 0 },
        { id: "c", kind: "text", prompt: "t", accepted: [] },
        { id: "d", kind: "choice", prompt: "d", options: ["Yes", "yes"], answer: 0 },
      ],
    };
    expect(lessonPublishProblems({ title: " " }, body, { source: "editor", hasPdf: false })).toEqual([
      "Give the lesson a title.",
      "Step 1 needs a title.",
      "Step 1 has no text yet.",
      "Question 1 needs a question.",
      "Question 1 has an empty option.",
      "Question 2 has no answer. Enter the correct number.",
      "Question 3 has no answer. Add at least one accepted answer.",
      "Question 4 has two options that say the same thing.",
    ]);
  });

  it("needs steps for a written lesson and the file for a PDF lesson", () => {
    const empty: LessonBody = { steps: [], practice: [] };
    expect(lessonPublishProblems({ title: "x" }, empty, { source: "editor", hasPdf: false })).toEqual([
      "Add at least one step.",
    ]);
    expect(lessonPublishProblems({ title: "x" }, empty, { source: "pdf", hasPdf: false })).toEqual([
      "Upload the PDF, or switch back to writing steps.",
    ]);
    expect(lessonPublishProblems({ title: "x" }, empty, { source: "pdf", hasPdf: true })).toEqual([]);
  });

  it("keeps a PDF lesson with no steps publishable, but still checks its questions", () => {
    const pdfLesson: LessonBody = { steps: [], practice: [{ id: "q", kind: "text", prompt: "Name it", accepted: [" "] }] };
    expect(lessonPublishProblems({ title: "x" }, pdfLesson, { source: "pdf", hasPdf: true })).toEqual([
      "Question 1 has no answer. Add at least one accepted answer.",
    ]);
  });
});

describe("lessonPublishIssues", () => {
  it("points each problem at the field the editor should open", () => {
    const body: LessonBody = {
      steps: [
        { id: "s-a", title: "Wire it", text: "Done." },
        { id: "s-b", title: "Test it", text: "  " },
      ],
      practice: [
        { id: "q-a", kind: "number", prompt: "Volts?", answer: null, tolerance: 0 },
        { id: "q-b", kind: "choice", prompt: "", options: ["A", ""], answer: 0 },
      ],
    };
    expect(lessonPublishIssues({ title: "" }, body, { source: "editor", hasPdf: false })).toEqual([
      { message: "Give the lesson a title.", field: "title" },
      { message: "Step 2 has no text yet.", field: "step:s-b:text" },
      { message: "Question 1 has no answer. Enter the correct number.", field: "question:q-a:answer" },
      { message: "Question 2 needs a question.", field: "question:q-b:prompt" },
      { message: "Question 2 has an empty option.", field: "question:q-b:options" },
    ]);
  });

  it("names the steps list for an empty written lesson and the PDF for a PDF lesson without one", () => {
    const empty: LessonBody = { steps: [], practice: [] };
    expect(lessonPublishIssues({ title: "x" }, empty, { source: "editor", hasPdf: false })).toEqual([
      { message: "Add at least one step.", field: "steps" },
    ]);
    expect(lessonPublishIssues({ title: "x" }, empty, { source: "pdf", hasPdf: false })[0]?.field).toBe("pdf");
  });
});
