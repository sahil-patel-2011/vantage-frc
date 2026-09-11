import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/vercel-ignore-build.mjs");

function ignoreExit(ref: string | undefined) {
  const env = { ...process.env };
  if (ref === undefined) {
    delete env.VERCEL_GIT_COMMIT_REF;
  } else {
    env.VERCEL_GIT_COMMIT_REF = ref;
  }
  return spawnSync(process.execPath, [script], { env, encoding: "utf8" }).status;
}

describe("vercel ignore build", () => {
  it("exits 1 so Vercel builds main", () => {
    expect(ignoreExit("main")).toBe(1);
  });

  it("exits 0 so non-main branches skip", () => {
    expect(ignoreExit("cursor/video-student-shell-c0b5")).toBe(0);
    expect(ignoreExit("cursor/vercel-ignore-preview-c0b5")).toBe(0);
    expect(ignoreExit("")).toBe(0);
    expect(ignoreExit(undefined)).toBe(0);
  });
});

describe("vercel.json skip config", () => {
  const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
    git?: { deploymentEnabled?: Record<string, boolean> };
    ignoreCommand?: string;
  };

  it("disables git deploys for every branch except main before a build slot is claimed", () => {
    expect(config.git?.deploymentEnabled?.["**"]).toBe(false);
    expect(config.git?.deploymentEnabled?.main).toBe(true);
  });

  it("points ignoreCommand at the quote-free script", () => {
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
  });
});
