import { describe, expect, it } from "vitest";
import { statusLabel } from "./status-label";

describe("statusLabel", () => {
  it("names stored statuses the way people say them", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("finalized")).toBe("Final");
    expect(statusLabel("canceled")).toBe("Cancelled");
    expect(statusLabel("waiting_on_vendor")).toBe("Waiting on vendor");
    expect(statusLabel("")).toBe("");
    expect(statusLabel(null)).toBe("");
  });
});
