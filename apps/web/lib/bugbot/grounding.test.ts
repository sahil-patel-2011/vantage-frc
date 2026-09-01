import { describe, expect, it } from "vitest";
import { asCommitSha, assertBugbotPhaseGrounding, lastScanFromReview, resolveBugbotTarget } from "./grounding";

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

describe("server Bugbot phase grounding", () => {
  const parent = {
    path: "team/robot scan",
    contentSha256: "digest",
    githubRepo: "team/robot",
    githubSha: SHA,
  };

  it("accepts a fix pinned to the scanned repository commit", () => {
    expect(() =>
      assertBugbotPhaseGrounding({ phase: "fix", parent, source: { ...parent } }),
    ).not.toThrow();
  });

  it("rejects missing, unpinned, or retargeted fix source before metering", () => {
    expect(() =>
      assertBugbotPhaseGrounding({ phase: "fix", parent: null, source: { ...parent } }),
    ).toThrow(/parent/i);
    expect(() =>
      assertBugbotPhaseGrounding({
        phase: "fix",
        parent,
        source: { ...parent, githubSha: null },
      }),
    ).toThrow(/commit SHA/i);
    expect(() =>
      assertBugbotPhaseGrounding({
        phase: "fix",
        parent,
        source: { ...parent, githubRepo: "other/robot" },
      }),
    ).toThrow(/does not match/i);
  });

  it("rebuilds a repo last-scan from a stored review and never invents a buffer pin", () => {
    expect(lastScanFromReview({ githubRepo: "team/robot", githubRef: "main", githubSha: SHA })).toEqual({
      scanRepo: true,
      repo: "team/robot",
      ref: "main",
      sha: SHA,
    });
    expect(lastScanFromReview({ githubRepo: null, githubRef: null, githubSha: null })).toEqual({
      scanRepo: false,
      repo: null,
      ref: null,
      sha: null,
    });
    expect(lastScanFromReview(null)).toBeNull();
  });

  it("allows recheck at a new head but still requires the same repository", () => {
    expect(() =>
      assertBugbotPhaseGrounding({
        phase: "recheck",
        parent,
        source: { ...parent, githubSha: "b".repeat(40) },
      }),
    ).not.toThrow();
  });
});
