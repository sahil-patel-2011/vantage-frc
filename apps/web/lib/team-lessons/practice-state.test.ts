import { describe, expect, it } from "vitest";
import { answersLocked, firstToRevisit, INITIAL_PRACTICE, practicePayload, practiceReducer, type PracticeAction, type PracticeState } from "./practice-state";
import type { PracticeSubmission } from "./types";

const wrong: PracticeSubmission = {
  result: {
    results: [
      { id: "q-1", correct: true, feedback: "Correct." },
      { id: "q-2", correct: false, feedback: "Too high." },
    ],
    score: 1,
    total: 2,
    passed: false,
    passMark: 2,
  },
  stored: false,
  attempt: null,
};

const run = (actions: PracticeAction[], from: PracticeState = INITIAL_PRACTICE) => actions.reduce(practiceReducer, from);

describe("practiceReducer", () => {
  it("locks the answers while checking and while a grade is shown", () => {
    const checking = run([{ type: "answer", id: "q-2", value: "14" }, { type: "check" }]);
    expect(answersLocked(checking)).toBe(true);
    const graded = practiceReducer(checking, { type: "checked", submitted: wrong });
    expect(answersLocked(graded)).toBe(true);
    expect(practiceReducer(graded, { type: "answer", id: "q-2", value: "12" })).toBe(graded);
  });

  it("Try again after a wrong answer re-enables the answers, clears the result and keeps what was typed", () => {
    const graded = run([{ type: "answer", id: "q-2", value: "14" }, { type: "check" }, { type: "checked", submitted: wrong }]);
    const retried = practiceReducer(graded, { type: "retry" });
    expect(answersLocked(retried)).toBe(false);
    expect(retried.submitted).toBeNull();
    expect(retried.error).toBeNull();
    expect(retried.answers).toEqual({ "q-2": "14" });
    // ...and the box takes a new answer.
    expect(practiceReducer(retried, { type: "answer", id: "q-2", value: "12" }).answers["q-2"]).toBe("12");
  });

  it("does not grade twice: a submit while checking or graded is ignored", () => {
    const checking = run([{ type: "check" }]);
    expect(practiceReducer(checking, { type: "check" })).toBe(checking);
    const graded = practiceReducer(checking, { type: "checked", submitted: wrong });
    expect(practiceReducer(graded, { type: "check" })).toBe(graded);
  });

  it("keeps the answers editable when the check fails", () => {
    const failed = run([{ type: "answer", id: "q-1", value: "1" }, { type: "check" }, { type: "failed", error: "Couldn't reach Vantage." }]);
    expect(answersLocked(failed)).toBe(false);
    expect(failed.error).toBe("Couldn't reach Vantage.");
    expect(failed.answers).toEqual({ "q-1": "1" });
  });
});

describe("firstToRevisit", () => {
  it("is the first question marked Not yet, in page order", () => {
    expect(firstToRevisit(wrong, ["q-1", "q-2"])).toBe("q-2");
    expect(firstToRevisit(null, ["q-1"])).toBeNull();
  });
});

describe("practicePayload", () => {
  it("leaves blanks out and sends a choice as its option number", () => {
    const questions = [
      { id: "a", kind: "choice" as const },
      { id: "b", kind: "number" as const },
      { id: "c", kind: "text" as const },
    ];
    expect(practicePayload(questions, { a: "2", b: "", c: "Gradle" })).toEqual({ a: 2, c: "Gradle" });
  });
});
