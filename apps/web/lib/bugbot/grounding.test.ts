import { describe, expect, it } from "vitest";
import {
  asCommitSha,
  bugbotFindingFile,
  filterBugbotFindingsToFile,
  normaliseBugbotPath,
  resolveBugbotFileTarget,
  resolveBugbotTarget,
} from "./grounding";

const SHA = "a".repeat(40);

describe("asCommitSha", () => {
  it("accepts a full 40-hex sha and normalizes case", () => {
    expect(asCommitSha(SHA.toUpperCase())).toBe(SHA);
    expect(asCommitSha(` ${SHA} `)).toBe(SHA);
  });

  it("rejects short, branchy, or missing values", () => {
    expect(asCommitSha("main")).toBeNull();
    expect(asCommitSha("abc123")).toBeNull();
    expect(asCommitSha(`${SHA}z`)).toBeNull();
    expect(asCommitSha("g".repeat(40))).toBeNull();
    expect(asCommitSha(undefined)).toBeNull();
    expect(asCommitSha(null)).toBeNull();
    expect(asCommitSha("")).toBeNull();
  });
});

describe("resolveBugbotTarget", () => {
  const repoScan = { scanRepo: true, repo: "team/robot", ref: "main", sha: SHA };

  it("scan follows the caller's repo/buffer choice and never pins", () => {
    expect(
      resolveBugbotTarget({ phase: "scan", scanRepoRequested: true, lastScan: repoScan }),
    ).toEqual({ useRepo: true, repo: null, ref: null, pinnedSha: null });
    expect(
      resolveBugbotTarget({ phase: "scan", scanRepoRequested: false, lastScan: repoScan }),
    ).toEqual({ useRepo: false, repo: null, ref: null, pinnedSha: null });
  });

  it("fix after a repo scan targets the repo pinned to the scanned sha, not the buffer", () => {
    expect(
      resolveBugbotTarget({ phase: "fix", scanRepoRequested: false, lastScan: repoScan }),
    ).toEqual({ useRepo: true, repo: "team/robot", ref: "main", pinnedSha: SHA });
  });

  it("recheck after a repo scan re-targets the repo at head (no pinned sha)", () => {
    expect(
      resolveBugbotTarget({ phase: "recheck", scanRepoRequested: false, lastScan: repoScan }),
    ).toEqual({ useRepo: true, repo: "team/robot", ref: "main", pinnedSha: null });
  });

  it("fix after a buffer scan keeps editor-paste behaviour", () => {
    const bufferScan = { scanRepo: false, repo: null, ref: null, sha: null };
    expect(
      resolveBugbotTarget({ phase: "fix", scanRepoRequested: false, lastScan: bufferScan }),
    ).toEqual({ useRepo: false, repo: null, ref: null, pinnedSha: null });
    expect(
      resolveBugbotTarget({ phase: "fix", scanRepoRequested: false, lastScan: null }),
    ).toEqual({ useRepo: false, repo: null, ref: null, pinnedSha: null });
  });

  it("fix after a repo scan whose sha could not be resolved still targets the repo", () => {
    const unpinned = { ...repoScan, sha: null };
    expect(
      resolveBugbotTarget({ phase: "fix", scanRepoRequested: false, lastScan: unpinned }),
    ).toEqual({ useRepo: true, repo: "team/robot", ref: "main", pinnedSha: null });
  });
});

describe("per-finding fix / recheck targeting", () => {
  const chunks = [
    ["src/main/java/frc/robot/Robot.java", "src/main/java/frc/robot/RobotContainer.java"],
    ["src/main/java/frc/robot/subsystems/Arm.java", "src/main/java/frc/robot/subsystems/Drive.java"],
    ["src/main/java/frc/robot/commands/Score.java"],
  ];

  it("maps a finding's file to the chunk that owns it — chunk 0 is never a default", () => {
    expect(
      resolveBugbotFileTarget({ chunks, filePath: "src/main/java/frc/robot/subsystems/Arm.java" }),
    ).toEqual({ filePath: "src/main/java/frc/robot/subsystems/Arm.java", chunkIndex: 1 });
    expect(
      resolveBugbotFileTarget({ chunks, filePath: "src/main/java/frc/robot/commands/Score.java" }),
    ).toEqual({ filePath: "src/main/java/frc/robot/commands/Score.java", chunkIndex: 2 });
  });

  it("only trusts the client's chunk hint when the server plan agrees", () => {
    expect(
      resolveBugbotFileTarget({ chunks, filePath: "src/main/java/frc/robot/subsystems/Arm.java", chunkHint: 0 }),
    ).toMatchObject({ chunkIndex: 1 });
    expect(
      resolveBugbotFileTarget({ chunks, filePath: "src/main/java/frc/robot/subsystems/Arm.java", chunkHint: 1 }),
    ).toMatchObject({ chunkIndex: 1 });
  });

  it("keeps the file but claims no chunk when the plan does not list it", () => {
    expect(resolveBugbotFileTarget({ chunks, filePath: "src/main/java/frc/robot/util/Deferred.java" })).toEqual({
      filePath: "src/main/java/frc/robot/util/Deferred.java",
      chunkIndex: null,
    });
  });

  it("normalises separators and refuses unsafe or empty paths", () => {
    expect(normaliseBugbotPath(String.raw`\src\Robot.java`)).toBe("src/Robot.java");
    expect(normaliseBugbotPath("/src/Robot.java")).toBe("src/Robot.java");
    expect(normaliseBugbotPath("../etc/passwd")).toBe("");
    expect(normaliseBugbotPath("")).toBe("");
    expect(resolveBugbotFileTarget({ chunks, filePath: "../x.java" })).toBeNull();
    expect(resolveBugbotFileTarget({ chunks, filePath: undefined })).toBeNull();
    expect(resolveBugbotFileTarget({ chunks, filePath: "SRC/main/java/frc/robot/Robot.java" })).toMatchObject({
      chunkIndex: 0,
    });
  });

  it("derives a finding's file from its location when filePath is missing", () => {
    expect(bugbotFindingFile({ filePath: "src/Drive.java", location: "github-scan:12" })).toBe("src/Drive.java");
    expect(bugbotFindingFile({ location: "src/main/java/frc/robot/Robot.java:42" })).toBe(
      "src/main/java/frc/robot/Robot.java",
    );
  });

  it("filters the findings payload to the targeted file only", () => {
    const findings = [
      { filePath: "src/main/java/frc/robot/subsystems/Arm.java", location: "src/main/java/frc/robot/subsystems/Arm.java:4" },
      { filePath: "src/main/java/frc/robot/Robot.java", location: "src/main/java/frc/robot/Robot.java:9" },
      { location: "src/main/java/frc/robot/subsystems/arm.java:20" },
      { filePath: "src/main/java/frc/robot/commands/Score.java", location: "src/main/java/frc/robot/commands/Score.java:1" },
    ];
    const scoped = filterBugbotFindingsToFile(findings, "src/main/java/frc/robot/subsystems/Arm.java");
    expect(scoped.map((item) => item.location)).toEqual([
      "src/main/java/frc/robot/subsystems/Arm.java:4",
      "src/main/java/frc/robot/subsystems/arm.java:20",
    ]);
    expect(filterBugbotFindingsToFile(findings, "")).toEqual([]);
    expect(filterBugbotFindingsToFile(findings, "../Arm.java")).toEqual([]);
  });
});
