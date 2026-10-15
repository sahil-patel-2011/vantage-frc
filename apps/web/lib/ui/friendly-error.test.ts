import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "./friendly-error";

describe("friendlyErrorMessage", () => {
  it("never shows the browser's own timeout or network wording", () => {
    expect(friendlyErrorMessage(new DOMException("signal timed out", "TimeoutError"), "x")).toBe(
      "This is taking longer than usual. Try again.",
    );
    expect(friendlyErrorMessage(new TypeError("Failed to fetch"), "x")).toContain("Couldn't reach Vantage");
  });

  it("keeps a message the app threw on purpose, and falls back otherwise", () => {
    expect(friendlyErrorMessage(new Error("Only a team owner can do that."), "x")).toBe("Only a team owner can do that.");
    expect(friendlyErrorMessage("nope", "Could not load.")).toBe("Could not load.");
  });
});
