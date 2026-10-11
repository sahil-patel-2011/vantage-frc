import { describe, expect, it } from "vitest";
import { CONNECTION_DROPPED, TOOK_TOO_LONG, actionFailureMessage } from "./action-failure";

describe("actionFailureMessage", () => {
  it("turns the browser's fetch failures into one plain sentence", () => {
    expect(actionFailureMessage(new TypeError("Failed to fetch"), "x")).toBe(CONNECTION_DROPPED);
    expect(actionFailureMessage(new TypeError("Load failed"), "x")).toBe(CONNECTION_DROPPED);
    expect(actionFailureMessage(new Error("NetworkError when attempting to fetch resource."), "x")).toBe(CONNECTION_DROPPED);
  });

  it("says a timeout took too long instead of printing 'signal timed out'", () => {
    const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
    expect(actionFailureMessage(timeout, "x")).toBe(TOOK_TOO_LONG);
    expect(actionFailureMessage(new Error("signal timed out"), "x")).toBe(TOOK_TOO_LONG);
  });

  it("keeps a sentence the API wrote for people", () => {
    expect(actionFailureMessage(new Error("Attach the receipt as a PDF before submitting."), "x")).toBe(
      "Attach the receipt as a PDF before submitting.",
    );
  });

  it("falls back when there is nothing to say", () => {
    expect(actionFailureMessage(null, "Could not save.")).toBe("Could not save.");
    expect(actionFailureMessage(new Error(""), "Could not save.")).toBe("Could not save.");
  });
});
