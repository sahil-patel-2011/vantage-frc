import { describe, expect, it } from "vitest";
import {
  describeBugbotCoverage,
  mergeBugbotFileRecheck,
  mergeBugbotScanRun,
  type BugbotChunkOutcome,
  type BugbotRunFinding,
} from "./scan-run";

function finding(overrides: Partial<BugbotRunFinding> = {}): BugbotRunFinding {
  return {
    severity: "medium",
    location: "src/main/java/frc/robot/Robot.java:12",
    line: 12,
    finding: "Blocking call in periodic",
    evidence: "Thread.sleep(20)",
    source: "local_rule",
    fingerprint: "aaaa1111",
    ...overrides,
  };
}

function chunk(overrides: Partial<BugbotChunkOutcome> = {}): BugbotChunkOutcome {
  return {
    chunkIndex: 0,
    path: "github-scan",
    findings: [],
    droppedUngrounded: 0,
    chargeUsd: 1,
    reviewedFiles: [],
    skipped: [],
    skipCounts: [],
    candidateCount: 20,
    deferredCount: 0,
    treeTruncated: false,
    skippedListTruncated: false,
    newCount: 0,
    knownCount: 0,
    fixedCount: 0,
    fixedFindings: [],
    ...overrides,
  };
}

describe("chunked scan merge", () => {
  it("unions coverage and sums the running cost across chunks", () => {
    const result = mergeBugbotScanRun(
      [
        chunk({
          chunkIndex: 0,
          reviewedFiles: ["Robot.java", "RobotContainer.java"],
          findings: [finding()],
          newCount: 1,
          chargeUsd: 1,
        }),
        chunk({
          chunkIndex: 1,
          reviewedFiles: ["Drive.java"],
          findings: [finding({ fingerprint: "bbbb2222", severity: "high", location: "Drive.java:4" })],
          knownCount: 1,
          chargeUsd: 1,
        }),
      ],
      { plannedChunks: 2 },
    );
    expect(result.reviewedFiles).toEqual(["Robot.java", "RobotContainer.java", "Drive.java"]);
    expect(result.spentUsd).toBe(2);
    expect(result.findings).toHaveLength(2);
    // Highest severity anywhere in the run drives the headline risk.
    expect(result.riskLevel).toBe("high");
    expect(result.findings[0]?.severity).toBe("high");
    expect(result.newCount).toBe(1);
    expect(result.knownCount).toBe(1);
    expect(result.partial).toBe(false);
  });

  it("never counts one finding twice when chunks overlap", () => {
    const result = mergeBugbotScanRun(
      [
        chunk({ findings: [finding()], reviewedFiles: ["Robot.java"] }),
        chunk({ chunkIndex: 1, findings: [finding()], reviewedFiles: ["Robot.java"] }),
      ],
      { plannedChunks: 2 },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.reviewedFiles).toEqual(["Robot.java"]);
  });

  it("is PARTIAL when the run stops before every planned chunk", () => {
    const result = mergeBugbotScanRun([chunk({ reviewedFiles: ["Robot.java"] })], { plannedChunks: 4 });
    expect(result.partial).toBe(true);
    expect(result.partialReason).toContain("only 1 of 4 planned chunks ran");
    expect(describeBugbotCoverage(result)).toContain("PARTIAL");
  });

  it("is PARTIAL when robot code was deferred past the chunk budget", () => {
    const result = mergeBugbotScanRun(
      [chunk({ reviewedFiles: ["Robot.java"], deferredCount: 33, candidateCount: 41 })],
      { plannedChunks: 1 },
    );
    expect(result.partial).toBe(true);
    expect(result.partialReason).toContain("33 robot-code files are beyond");
    expect(describeBugbotCoverage(result)).toContain("Reviewed 1 of 41 robot-code files");
  });

  it("carries a stop reason (budget cutoff) into the partial state", () => {
    const result = mergeBugbotScanRun([chunk({ reviewedFiles: ["Robot.java"] })], {
      plannedChunks: 3,
      stoppedReason: "stopped after chunk 1: credit cap reached",
    });
    expect(result.partial).toBe(true);
    expect(result.partialReason).toContain("credit cap reached");
  });

  it("reports full coverage only when every chunk ran and nothing was deferred", () => {
    const result = mergeBugbotScanRun(
      [chunk({ reviewedFiles: ["Robot.java"], candidateCount: 1, skipCounts: [{ reason: "build_output", label: "build output", count: 220 }] })],
      { plannedChunks: 1 },
    );
    expect(result.partial).toBe(false);
    expect(describeBugbotCoverage(result)).toBe(
      "Reviewed 1 of 1 robot-code file, skipped 220 non-robot-code paths. Full coverage of this scan plan.",
    );
  });

  it("keeps a zero-finding run honest: no findings is not certification", () => {
    const result = mergeBugbotScanRun([chunk({ reviewedFiles: ["Robot.java"], candidateCount: 1 })], {
      plannedChunks: 1,
    });
    expect(result.findings).toHaveLength(0);
    expect(result.riskLevel).toBe("low");
    expect(result.localRiskCount).toBe(0);
  });
});

describe("read-cap honesty and one-file rechecks", () => {
  it("unions cut files across chunks and marks the run partial because of them", () => {
    const result = mergeBugbotScanRun(
      [
        chunk({ chunkIndex: 0, reviewedFiles: ["Robot.java", "Big.java"], truncatedFiles: ["Big.java"] }),
        chunk({ chunkIndex: 1, reviewedFiles: ["Drive.java", "Big.java"], truncatedFiles: ["Big.java", "Drive.java"] }),
      ],
      { plannedChunks: 2 },
    );
    expect(result.truncated).toBe(true);
    expect(result.truncatedFiles).toEqual(["Big.java", "Drive.java"]);
    expect(result.partial).toBe(true);
    expect(result.partialReason).toContain("2 files were cut at the read cap");
    expect(describeBugbotCoverage(result)).toContain("PARTIAL coverage");
  });

  it("is not partial when every planned chunk ran and nothing was cut", () => {
    const result = mergeBugbotScanRun([chunk({ reviewedFiles: ["Robot.java"], candidateCount: 1 })], {
      plannedChunks: 1,
    });
    expect(result.truncated).toBe(false);
    expect(result.truncatedFiles).toEqual([]);
    expect(result.partial).toBe(false);
  });

  it("folds a one-file recheck into the table without touching other files", () => {
    const previous = {
      path: "github-scan",
      riskLevel: "high" as const,
      findings: [
        finding({ fingerprint: "drive-1", filePath: "src/Drive.java", location: "src/Drive.java:4", severity: "high" }),
        finding({ fingerprint: "drive-2", filePath: "src/Drive.java", location: "src/Drive.java:9", severity: "low" }),
        finding({ fingerprint: "arm-1", filePath: "src/Arm.java", location: "src/Arm.java:2", severity: "medium" }),
      ],
      localRiskCount: 3,
      modelFindingCount: 0,
      droppedUngrounded: 1,
    };
    const merged = mergeBugbotFileRecheck(previous, {
      filePath: "src/Drive.java",
      findings: [finding({ fingerprint: "drive-2", filePath: "src/Drive.java", location: "src/Drive.java:9", severity: "low", source: "model" })],
      droppedUngrounded: 2,
    });
    // drive-1 is gone, drive-2 survived, arm-1 was never re-read and stays exactly as it was.
    expect(merged.findings.map((item) => item.fingerprint)).toEqual(["arm-1", "drive-2"]);
    expect(merged.riskLevel).toBe("medium");
    expect(merged.localRiskCount).toBe(1);
    expect(merged.modelFindingCount).toBe(1);
    expect(merged.droppedUngrounded).toBe(3);
    expect(merged.path).toBe("github-scan");
  });

  it("matches the recheck file case-insensitively and by location when filePath is absent", () => {
    const merged = mergeBugbotFileRecheck(
      {
        path: "github-scan",
        riskLevel: "high",
        findings: [finding({ fingerprint: "x", filePath: undefined, location: "SRC/Drive.java:4" })],
        localRiskCount: 1,
        modelFindingCount: 0,
        droppedUngrounded: 0,
      },
      { filePath: "src/drive.java", findings: [], droppedUngrounded: 0 },
    );
    expect(merged.findings).toEqual([]);
    expect(merged.riskLevel).toBe("low");
  });
});
