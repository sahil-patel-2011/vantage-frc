import { describe, expect, it } from "vitest";
import { personalEnvironment } from "../src/node/personal-environment.js";

describe("personal provider process boundary", () => {
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  it("isolates both providers and excludes inherited credentials and settings", () => {
    const inherited = { PATH: "/bin", HOME: "/home/user", OPENAI_API_KEY: "private", ANTHROPIC_API_KEY: "private", CLAUDE_CODE_OAUTH_TOKEN: "private", DATABASE_URL: "private", CODEX_HOME: "/shared/codex", CLAUDE_CONFIG_DIR: "/shared/claude", VANTAGE_DEVICE_TOKEN: "private" };
    for (const engine of ["codex", "claude"] as const) {
      const first = personalEnvironment(a, engine, inherited, "/home/user");
      const second = personalEnvironment(b, engine, inherited, "/home/user");
      expect(first.env.PATH).toBe("/bin");
      expect(first.directory).not.toBe(second.directory);
      expect(first.directory).toContain(a);
      expect(Object.keys(first.env).sort()).toEqual([engine === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR", "HOME", "PATH"]);
    }
  });
  it("rejects absent identities and paths disguised as identities", () => {
    for (const userId of ["", "../other", "person", `${a}/../${b}`]) expect(() => personalEnvironment(userId, "codex")).toThrow(/personal/);
    expect(personalEnvironment(a.toUpperCase(), "codex").directory).toBe(personalEnvironment(a, "codex").directory);
  });
});
