import { describe, expect, it } from "vitest";
import { bugbotBilledNote, bugbotScanMetaLine, formatScanElapsed } from "./scan-elapsed";

describe("formatScanElapsed", () => {
  it("prints seconds under a minute", () => {
    expect(formatScanElapsed(0)).toBe("under 1s");
    expect(formatScanElapsed(400)).toBe("under 1s");
    expect(formatScanElapsed(12_400)).toBe("12s");
  });

  it("prints minutes and leftover seconds", () => {
    expect(formatScanElapsed(60_000)).toBe("1m");
    expect(formatScanElapsed(64_000)).toBe("1m 4s");
    expect(formatScanElapsed(3_600_000)).toBe("1h");
    expect(formatScanElapsed(3_720_000)).toBe("1h 2m");
  });

  it("refuses a clock that never started", () => {
    expect(formatScanElapsed(Number.NaN)).toBe("");
    expect(formatScanElapsed(-4)).toBe("");
  });
});

describe("bugbotBilledNote", () => {
  it("names Ultra charges and the team's keys otherwise", () => {
    expect(bugbotBilledNote("ultra", 1)).toBe(" Charged $1.00 Bugbot Ultra.");
    expect(bugbotBilledNote("subscription")).toBe(" Uses your team's keys or plan allowance.");
    expect(bugbotBilledNote("ultra")).toBe(" Uses your team's keys or plan allowance.");
  });
});

describe("bugbotScanMetaLine", () => {
  it("joins model, file count, and elapsed when present", () => {
    expect(
      bugbotScanMetaLine({
        provider: "openai",
        model: "gpt-5",
        filesScanned: 8,
        elapsedMs: 12_400,
      }),
    ).toBe(" · openai/gpt-5 · 8 files · 12s");
  });

  it("stays empty when a scan has not finished", () => {
    expect(bugbotScanMetaLine({})).toBe("");
  });
});
