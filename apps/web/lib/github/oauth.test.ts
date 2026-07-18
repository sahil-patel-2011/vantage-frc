import { describe, expect, it } from "vitest";
import {
  createGitHubOAuthState,
  githubSetupStatus,
  isGitHubOAuthConfigured,
  verifyGitHubOAuthState,
} from "./oauth";
import { formatGitHubFileContext, formatGitHubTreeContext } from "./api";

describe("github oauth config", () => {
  it("reports setup required when env is blank", () => {
    const status = githubSetupStatus({});
    expect(status.configured).toBe(false);
    expect(status.setupRequired).toBe(true);
    expect(status.patAvailable).toBe(true);
    expect(isGitHubOAuthConfigured({})).toBe(false);
  });

  it("reads client credentials when present", () => {
    const env = {
      GITHUB_OAUTH_CLIENT_ID: "cid",
      GITHUB_OAUTH_CLIENT_SECRET: "csecret",
      BETTER_AUTH_URL: "https://app.example.com",
    };
    const status = githubSetupStatus(env);
    expect(status.configured).toBe(true);
    expect(status.setupRequired).toBe(false);
    expect(status.redirectUri).toBe("https://app.example.com/api/github/oauth/callback");
  });

  it("round-trips oauth state", () => {
    const env = { BETTER_AUTH_SECRET: "test-secret-for-hmac" };
    const state = createGitHubOAuthState({ orgId: "org-1", userId: "user-1" }, env);
    const claims = verifyGitHubOAuthState(state, env);
    expect(claims.orgId).toBe("org-1");
    expect(claims.userId).toBe("user-1");
  });
});

describe("github context formatting", () => {
  it("formats file provenance without inventing code", () => {
    const text = formatGitHubFileContext({
      path: "src/Robot.java",
      fullName: "team/robot",
      ref: "main",
      content: "class Robot {}",
      truncated: false,
      size: 14,
      htmlUrl: "https://github.com/team/robot/blob/main/src/Robot.java",
    });
    expect(text).toContain("[GitHub file] team/robot@main:src/Robot.java");
    expect(text).toContain("class Robot {}");
    expect(text.toLowerCase()).not.toContain("demo");
  });

  it("formats tree listings", () => {
    const text = formatGitHubTreeContext({
      fullName: "team/robot",
      ref: "main",
      truncated: true,
      entries: [
        { path: "src", type: "tree" },
        { path: "src/Robot.java", type: "blob", size: 10 },
      ],
    });
    expect(text).toContain("[GitHub tree] team/robot@main");
    expect(text).toContain("file src/Robot.java");
    expect(text).toContain("truncated");
  });
});
