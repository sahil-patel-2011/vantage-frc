import { describe, expect, it } from "vitest";
import { agentRunStoppedUnexpectedly } from "./agent-run-status";

describe("agentRunStoppedUnexpectedly", () => {
  const now = Date.parse("2026-09-28T18:00:00Z");

  it("identifies abandoned running requests without relabeling live or completed work", () => {
    expect(agentRunStoppedUnexpectedly({ status: "running", startedAt: "2026-09-28T17:49:59Z" }, now)).toBe(true);
    expect(agentRunStoppedUnexpectedly({ status: "running", startedAt: "2026-09-28T17:55:00Z" }, now)).toBe(false);
    expect(agentRunStoppedUnexpectedly({ status: "completed", startedAt: "2026-09-09T11:54:35Z" }, now)).toBe(false);
    expect(agentRunStoppedUnexpectedly({ status: "running", startedAt: "invalid" }, now)).toBe(false);
  });
});
