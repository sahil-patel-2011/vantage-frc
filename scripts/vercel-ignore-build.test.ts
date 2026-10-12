import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/vercel-ignore-build.mjs");

function ignoreExit(ref: string | undefined, vars: { sha?: string; release?: string } = {}) {
  const env = { ...process.env };
  delete env.VERCEL_GIT_COMMIT_SHA;
  delete env.VANTAGE_RELEASE_SHA;
  if (ref === undefined) {
    delete env.VERCEL_GIT_COMMIT_REF;
  } else {
    env.VERCEL_GIT_COMMIT_REF = ref;
  }
  if (vars.sha !== undefined) env.VERCEL_GIT_COMMIT_SHA = vars.sha;
  if (vars.release !== undefined) env.VANTAGE_RELEASE_SHA = vars.release;
  return spawnSync(process.execPath, [script], { env, encoding: "utf8" }).status;
}

const SHA = "3fdd84aa279b0612619b36760147cdde492f0c22";

/**
 * Automatic Git builds are off on purpose (AGENTS.md, "Hosting and compute
 * policy"): every push, main included, only stores code. A release builds only
 * the commit the operator marked in VANTAGE_RELEASE_SHA.
 */
describe("vercel ignore build", () => {
  it("exits 0 so a push to main does not start a build", () => {
    expect(ignoreExit("main")).toBe(0);
  });

  it("exits 0 so non-main branches skip", () => {
    expect(ignoreExit("cursor/video-student-shell-c0b5")).toBe(0);
    expect(ignoreExit("cursor/vercel-ignore-preview-c0b5")).toBe(0);
    expect(ignoreExit("")).toBe(0);
    expect(ignoreExit(undefined)).toBe(0);
  });

  it("builds only the commit marked as the release", () => {
    expect(ignoreExit("main", { sha: SHA, release: SHA })).toBe(1);
    expect(ignoreExit("main", { sha: SHA, release: SHA.toUpperCase() })).toBe(1);
  });

  it("skips any other commit, a missing mark, or a mark that is not a full SHA", () => {
    expect(ignoreExit("main", { sha: SHA })).toBe(0);
    expect(ignoreExit("main", { sha: SHA, release: "" })).toBe(0);
    expect(ignoreExit("main", { sha: SHA, release: "a".repeat(40) })).toBe(0);
    expect(ignoreExit("main", { sha: SHA, release: SHA.slice(0, 7) })).toBe(0);
    expect(ignoreExit("main", { release: SHA })).toBe(0);
  });
});

describe("vercel.json skip config", () => {
  const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
    git?: { deploymentEnabled?: Record<string, boolean> };
    ignoreCommand?: string;
  };

  it("disables git deploys for every branch, main included, before a build slot is claimed", () => {
    expect(config.git?.deploymentEnabled).toEqual({ "**": false });
  });

  it("points ignoreCommand at the quote-free script", () => {
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
  });
});
