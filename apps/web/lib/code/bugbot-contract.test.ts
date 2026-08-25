import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeBugbotReview } from "@vantage/agent/bugbot";
import { labelBugbotFindings } from "./bugbot-store";

const WEB_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/** Every non-test .ts under a directory, recursively, as web-root-relative paths. */
function sourceFiles(relativeDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(WEB_ROOT, relativeDir), { withFileTypes: true })) {
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(relative));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(relative);
  }
  return out;
}

/**
 * Bugbot proposes; humans apply. The contract is only real if nothing in the
 * request path can write to GitHub, so assert it against the source itself —
 * a future "just push the fix" helper has to break this test first.
 *
 * The file list is enumerated, not hand-written: adding a new module under
 * lib/github or app/api/github must not be a way around the contract.
 */
describe("Bugbot never pushes", () => {
  /**
   * The ONE legitimate write in this surface: exchanging an OAuth code for a
   * token at github.com/login/oauth/access_token. It touches no repository.
   */
  const OAUTH_TOKEN_EXCHANGE = "lib/github/oauth.ts";

  const sources = [
    ...sourceFiles("lib/github"),
    ...sourceFiles("app/api/github"),
    ...sourceFiles("app/api/code"),
    "lib/code/bugbot-store.ts",
  ];

  it("covers the whole GitHub + code request surface", () => {
    expect(sources).toContain("app/api/code/route.ts");
    expect(sources).toContain("lib/github/api.ts");
    expect(sources).toContain("app/api/github/contents/route.ts");
    expect(sources.length).toBeGreaterThan(6);
  });

  it("has no write verb against any GitHub repo endpoint", () => {
    for (const relative of sources) {
      const text = read(relative);
      if (relative !== OAUTH_TOKEN_EXCHANGE) {
        expect(text, relative).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
      }
      expect(text, relative).not.toMatch(/\/git\/(refs|commits|blobs|trees)\b[^\n]*method/);
      expect(text, relative).not.toMatch(/\bpulls\b|createPullRequest|createOrUpdateFileContents/);
      // No repo-scoped write endpoints, whatever the verb is spelled like.
      expect(text, relative).not.toMatch(/\/repos\/[^\n"'`]*\/(merges|releases|dispatches)\b/);
    }
  });

  it("keeps the OAuth exception scoped to the token endpoint, not a repo", () => {
    const text = read(OAUTH_TOKEN_EXCHANGE);
    const writes = text.match(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(text).toContain("login/oauth/access_token");
    expect(text).not.toMatch(/\/repos\//);
  });

  it("returns the proposal-only contract with every diff", () => {
    const route = read("app/api/code/route.ts");
    expect(route).toContain('executionState: "proposal_only"');
    expect(route).toContain("requiresHumanApproval: true");
    expect(route).toContain("pushedToGitHub: false");
  });

  it("keeps the never-deploy instruction in the fix prompt", () => {
    const prompt = readFileSync(
      join(WEB_ROOT, "..", "..", "packages", "agent", "src", "bugbot.ts"),
      "utf8",
    );
    expect(prompt).toContain("Never deploy. Never push to GitHub.");
  });
});

describe("finding delta labelling", () => {
  it("marks only the fingerprints this scan had not seen before as new", () => {
    const review = mergeBugbotReview({
      path: "Drive.java",
      content: "public class Drive {\n  private final TalonFX a = new TalonFX(3);\n  private final TalonFX b = new TalonFX(3);\n}\n",
    });
    const first = review.findings[0]!.fingerprint!;
    const labelled = labelBugbotFindings(review.findings, [first]);
    expect(labelled.find((item) => item.fingerprint === first)?.delta).toBe("new");
    expect(labelled.filter((item) => item.fingerprint !== first).every((item) => item.delta === "known")).toBe(
      true,
    );
  });
});
