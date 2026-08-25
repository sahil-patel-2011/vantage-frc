import { describe, expect, it } from "vitest";
import { asCommitSha, resolveBugbotTarget } from "./grounding";

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
