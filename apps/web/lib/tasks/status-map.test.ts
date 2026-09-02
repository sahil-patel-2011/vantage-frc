import { describe, expect, it } from "vitest";
import { canonicalStatus, coarseStatus, isCoarseStatus } from "./status-map";

describe("coarseStatus", () => {
  it("folds the five board statuses into the three list statuses", () => {
    expect(coarseStatus("todo")).toBe("todo");
    expect(coarseStatus("in_progress")).toBe("doing");
    expect(coarseStatus("blocked")).toBe("doing");
    expect(coarseStatus("done")).toBe("done");
    expect(coarseStatus("archived")).toBe("done");
  });
});

describe("canonicalStatus", () => {
  it("maps list statuses back to the board", () => {
    expect(canonicalStatus("todo", "in_progress")).toBe("todo");
    expect(canonicalStatus("doing", "todo")).toBe("in_progress");
    expect(canonicalStatus("done", null)).toBe("done");
  });

  it("never silently unblocks a blocked task from the coarse list", () => {
    expect(canonicalStatus("doing", "blocked")).toBe("blocked");
  });
});

describe("isCoarseStatus", () => {
  it("accepts only the three list values", () => {
    expect(isCoarseStatus("doing")).toBe(true);
    expect(isCoarseStatus("in_progress")).toBe(false);
    expect(isCoarseStatus(undefined)).toBe(false);
  });
});
