import { afterEach, describe, expect, it } from "vitest";
import {
  FEEDBACK_OPEN_EVENT,
  feedbackOpenKind,
  markFeedbackHandled,
  openFeedback,
} from "./feedback-open";

// The unit tests run in node; a bare EventTarget is all the window these helpers need.
const globals = globalThis as unknown as { window?: EventTarget };

afterEach(() => {
  delete globals.window;
});

describe("openFeedback", () => {
  it("does nothing, and says so, where there is no window", () => {
    expect(openFeedback()).toBe(false);
  });

  it("says nothing answered when no dialog is listening, so a link can fall back to /report-bug", () => {
    globals.window = new EventTarget();
    expect(openFeedback()).toBe(false);
  });

  it("opens the dialog on the kind asked for and reports that it was taken", () => {
    const target = new EventTarget();
    globals.window = target;
    const seen: Array<string | undefined> = [];
    target.addEventListener(FEEDBACK_OPEN_EVENT, (event) => {
      seen.push(feedbackOpenKind(event));
      markFeedbackHandled(event);
    });
    expect(openFeedback("idea")).toBe(true);
    expect(openFeedback()).toBe(true);
    expect(seen).toEqual(["idea", undefined]);
  });

  it("uses the event name the account menu, the Help page and the button agree on", () => {
    expect(FEEDBACK_OPEN_EVENT).toBe("vantage:feedback-open");
  });

  it("ignores a kind it does not know", () => {
    expect(feedbackOpenKind(new CustomEvent(FEEDBACK_OPEN_EVENT, { detail: { kind: "praise" } }))).toBeUndefined();
    expect(feedbackOpenKind(new Event(FEEDBACK_OPEN_EVENT))).toBeUndefined();
  });
});
