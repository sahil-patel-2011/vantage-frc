import { describe, expect, it } from "vitest";
import { CODE_COACH_SAMPLE, CODE_COACH_SAMPLE_DIFF } from "../code/code-related";
import { lastScanFromReview } from "./grounding";
import {
  applyBugbotDiffToFiles,
  parseBugbotDiffPaths,
  prepareBugbotWritePr,
  submitApprovedBugbotPullRequest,
} from "./write-pr";

const SHA = "a".repeat(40);
const DIFF = [
  "--- a/src/main/java/frc/robot/Drive.java",
  "+++ b/src/main/java/frc/robot/Drive.java",
  "@@ -1,3 +1,3 @@",
  " public void periodic() {",
  "-  driveMotor.set(3);",
  "+  driveMotor.set(MathUtil.clamp(demand, -1.0, 1.0));",
  " }",
].join("\n");

const repoScan = { scanRepo: true, repo: "team/robot", ref: "main", sha: SHA };

describe("prepareBugbotWritePr", () => {
  it("targets the scanned repo+sha from resolveBugbotTarget, not the sample textarea", () => {
    const prepared = prepareBugbotWritePr({
      phase: "fix",
      scanRepoRequested: false,
      lastScan: repoScan,
      humanApproved: false,
      unifiedDiff: DIFF,
    });
    expect(prepared.useRepo).toBe(true);
    expect(prepared.repo).toBe("team/robot");
    expect(prepared.baseSha).toBe(SHA);
    expect(prepared.ready).toBe(false);
    expect(prepared.executionState).toBe("proposal_only");
    expect(prepared.pushedToGitHub).toBe(false);
    expect(prepared.paths).toEqual(["src/main/java/frc/robot/Drive.java"]);
    expect(prepared.headBranch).toBe(`vantage/bugbot-${SHA.slice(0, 7)}`);
    expect(prepared.compareUrl).toContain("github.com/team/robot/compare/");
  });

  it("becomes ready only after an explicit human approval", () => {
    const prepared = prepareBugbotWritePr({
      phase: "fix",
      lastScan: repoScan,
      humanApproved: true,
      unifiedDiff: DIFF,
    });
    expect(prepared.ready).toBe(true);
    expect(prepared.executionState).toBe("approved_ready");
  });

  it("refuses a buffer / teaching-sample last scan", () => {
    const buffer = lastScanFromReview({ githubRepo: null, githubRef: null, githubSha: null });
    expect(buffer).toEqual({ scanRepo: false, repo: null, ref: null, sha: null });
    expect(() =>
      prepareBugbotWritePr({
        phase: "fix",
        lastScan: buffer,
        humanApproved: true,
        unifiedDiff: CODE_COACH_SAMPLE_DIFF,
      }),
    ).toThrow(/not the editor buffer/i);
    expect(CODE_COACH_SAMPLE).toContain("Timer.delay");
  });

  it("refuses a repo scan whose sha never resolved", () => {
    expect(() =>
      prepareBugbotWritePr({
        phase: "fix",
        lastScan: { ...repoScan, sha: null },
        humanApproved: true,
        unifiedDiff: DIFF,
      }),
    ).toThrow(/scanned commit sha/i);
  });
});

describe("applyBugbotDiffToFiles", () => {
  it("applies a grounded hunk and refuses a path that was not loaded from the commit", () => {
    const applied = applyBugbotDiffToFiles(
      [{ path: "src/main/java/frc/robot/Drive.java", content: "public void periodic() {\n  driveMotor.set(3);\n}" }],
      DIFF,
    );
    expect(applied[0]?.content).toContain("MathUtil.clamp");
    expect(applied[0]?.content).not.toContain("driveMotor.set(3)");
    const withNewline = applyBugbotDiffToFiles(
      [{ path: "src/main/java/frc/robot/Drive.java", content: "public void periodic() {\n  driveMotor.set(3);\n}\n" }],
      DIFF,
    );
    expect(withNewline[0]?.content.endsWith("\n")).toBe(true);
    expect(() =>
      applyBugbotDiffToFiles([{ path: "other/Robot.java", content: CODE_COACH_SAMPLE }], DIFF),
    ).toThrow(/not loaded from the scanned commit/i);
  });
});

describe("parseBugbotDiffPaths", () => {
  it("ignores /dev/null and parent-directory escapes", () => {
    expect(
      parseBugbotDiffPaths("--- a/../../secrets.env\n+++ b/../../secrets.env\n@@ -1 +1 @@\n-a\n+b\n"),
    ).toEqual([]);
    expect(parseBugbotDiffPaths(DIFF)).toEqual(["src/main/java/frc/robot/Drive.java"]);
  });
});

describe("submitApprovedBugbotPullRequest", () => {
  it("refuses a proposal-only payload and opens a PR only after approval", async () => {
    const draft = prepareBugbotWritePr({
      phase: "fix",
      lastScan: repoScan,
      humanApproved: false,
      unifiedDiff: DIFF,
    });
    await expect(
      submitApprovedBugbotPullRequest(
        async () => new Response("{}", { status: 500 }),
        draft,
        [{ path: "src/main/java/frc/robot/Drive.java", content: "fixed" }],
      ),
    ).rejects.toThrow(/human approves/i);

    const calls: Array<{ path: string; method: string | undefined; body: string | undefined }> = [];
    const http = async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
      if (path.endsWith("/git/refs") && init?.method === "POST") {
        return Response.json({ ref: "refs/heads/vantage/bugbot-aaaaaaaa" }, { status: 201 });
      }
      if (path.includes("/contents/") && init?.method === "PUT") {
        return Response.json({ content: { path: "Drive.java" } }, { status: 200 });
      }
      if (path.includes("/contents/")) {
        return Response.json({ sha: "blobsha" }, { status: 200 });
      }
      if (path.endsWith("/pulls")) {
        return Response.json({ html_url: "https://github.com/team/robot/pull/12", number: 12 }, { status: 201 });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    };

    const prepared = prepareBugbotWritePr({
      phase: "fix",
      lastScan: repoScan,
      humanApproved: true,
      unifiedDiff: DIFF,
    });
    const opened = await submitApprovedBugbotPullRequest(http, prepared, [
      { path: "src/main/java/frc/robot/Drive.java", content: "public void periodic() {\n  driveMotor.set(MathUtil.clamp(demand, -1.0, 1.0));\n}\n" },
    ]);
    expect(opened).toEqual({
      htmlUrl: "https://github.com/team/robot/pull/12",
      number: 12,
      headBranch: prepared.headBranch,
      openedPullRequest: true,
    });
    const createdRef = calls.find((call) => call.path.endsWith("/git/refs") && call.method === "POST");
    expect(createdRef?.body).toContain(SHA);
    expect(calls.some((call) => call.path.endsWith("/pulls") && call.method === "POST")).toBe(true);
    expect(calls.some((call) => call.body?.includes(CODE_COACH_SAMPLE))).toBe(false);
  });
});
