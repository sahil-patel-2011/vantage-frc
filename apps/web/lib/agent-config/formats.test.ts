import { describe, expect, it } from "vitest";
import {
  MAX_RULES_ITEM_CHARS,
  looksLikeSecretValue,
  parseFrontmatter,
  parseMcpServer,
  parsePermissions,
  parseRuleScope,
  parseSubagent,
  validateAgentConfigContent,
  validateAgentConfigName,
  validateMcpServer,
  validatePermissions,
  validateRules,
  validateSkill,
  validateSubagent,
} from "./formats";

describe("names", () => {
  it("accepts filename-safe slugs and rejects everything else", () => {
    expect(validateAgentConfigName("drivetrain-reviewer").ok).toBe(true);
    expect(validateAgentConfigName("a").ok).toBe(true);
    for (const bad of ["", "Has Spaces", "UPPER", "-leading", "über", "a/b", "a".repeat(65)]) {
      expect(validateAgentConfigName(bad).ok).toBe(false);
    }
  });
});

describe("rules", () => {
  it("accepts plain markdown", () => {
    expect(validateRules("- Always use meters.\n- SparkMax current limits are mandatory.").ok).toBe(true);
  });
  it("rejects empty, oversized, and marker-containing rules", () => {
    expect(validateRules("   \n").ok).toBe(false);
    expect(validateRules("x".repeat(MAX_RULES_ITEM_CHARS + 1)).ok).toBe(false);
    expect(validateRules("<!-- BEGIN VANTAGE TEAM AGENT CONFIG -->").ok).toBe(false);
  });
  it("accepts the optional Cursor scope frontmatter but rejects unknown keys", () => {
    expect(validateRules(`---\nglobs: src/**\nalwaysApply: false\n---\n- rule`).ok).toBe(true);
    const unknown = validateRules(`---\nname: nope\n---\n- rule`);
    expect(unknown.ok).toBe(false);
    expect(unknown.problems.join(" ")).toMatch(/only supports description, globs, and alwaysApply/);
    // A frontmatter-only item has no rule body.
    expect(validateRules(`---\nglobs: src/**\n---\n`).ok).toBe(false);
  });
});

describe("parseRuleScope", () => {
  it("treats plain markdown as all body with no scoping", () => {
    const scope = parseRuleScope("- meters only");
    expect(scope).toMatchObject({ body: "- meters only", description: null, globs: null, alwaysApply: null });
  });
  it("extracts description, comma-separated globs, and alwaysApply, leaving only the body", () => {
    const scope = parseRuleScope(
      `---\ndescription: Drivetrain conventions\nglobs: src/main/**/*.java, "**/*Drive*.java"\nalwaysApply: false\n---\n- SparkMax limits.`,
    );
    expect(scope.description).toBe("Drivetrain conventions");
    expect(scope.globs).toEqual(["src/main/**/*.java", "**/*Drive*.java"]);
    expect(scope.alwaysApply).toBe(false);
    expect(scope.body.trim()).toBe("- SparkMax limits.");
    expect(scope.problems).toEqual([]);
  });
  it("accepts globs as a YAML block list", () => {
    const scope = parseRuleScope(`---\nglobs:\n  - src/**\n  - "**/*.java"\n---\nbody`);
    expect(scope.globs).toEqual(["src/**", "**/*.java"]);
  });
  it("reports bad alwaysApply and empty globs", () => {
    expect(parseRuleScope(`---\nalwaysApply: maybe\n---\nbody`).problems.join(" ")).toMatch(/alwaysApply/);
    expect(parseRuleScope(`---\nglobs: ,\n---\nbody`).problems.join(" ")).toMatch(/globs/);
  });
});

describe("frontmatter parsing", () => {
  it("parses simple fields, quoted values, folded scalars, and block lists", () => {
    const parsed = parseFrontmatter(
      `---\nname: reviewer\ndescription: >-\n  Reviews code\n  carefully\nmodel: "sonnet"\ntools:\n  - Read\n  - Grep\n---\n\nBody text`,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.fields.name).toBe("reviewer");
    expect(parsed.fields.description).toBe("Reviews code carefully");
    expect(parsed.fields.model).toBe("sonnet");
    expect(parsed.fields.tools).toEqual(["Read", "Grep"]);
    expect(parsed.body.trim()).toBe("Body text");
  });
  it("reports missing or unclosed frontmatter", () => {
    expect(parseFrontmatter("no frontmatter").ok).toBe(false);
    expect(parseFrontmatter("---\nname: x\n").ok).toBe(false);
  });
});

describe("subagent", () => {
  const valid = `---\nname: drivetrain-reviewer\ndescription: Reviews drivetrain code\ntools: Read, Grep\nmodel: sonnet\n---\n\nYou review FRC drivetrain code.`;
  it("accepts the documented .claude/agents shape and extracts fields", () => {
    const { result, subagent } = parseSubagent(valid);
    expect(result.ok).toBe(true);
    expect(subagent).toMatchObject({
      name: "drivetrain-reviewer",
      description: "Reviews drivetrain code",
      tools: "Read, Grep",
      model: "sonnet",
    });
  });
  it("accepts tools as a block list", () => {
    const listForm = `---\nname: r\ndescription: d\ntools:\n  - Read\n  - Bash\n---\nprompt`;
    const { subagent } = parseSubagent(listForm);
    expect(subagent?.tools).toBe("Read, Bash");
  });
  it("rejects missing name/description, bad names, and empty bodies", () => {
    expect(validateSubagent(`---\ndescription: d\n---\nbody`).ok).toBe(false);
    expect(validateSubagent(`---\nname: Bad Name\ndescription: d\n---\nbody`).ok).toBe(false);
    expect(validateSubagent(`---\nname: ok\ndescription: d\n---\n`).ok).toBe(false);
  });
});

describe("mcp-server", () => {
  it("accepts stdio entries with placeholder env", () => {
    const { result, entry } = parseMcpServer(
      `{"command":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":{"GITHUB_TOKEN":"\${GITHUB_TOKEN}"}}`,
    );
    expect(result.ok).toBe(true);
    expect(entry).toMatchObject({ command: "npx" });
  });
  it("accepts remote url entries and unwraps a pasted mcpServers wrapper", () => {
    expect(validateMcpServer(`{"url":"https://mcp.example.com/sse"}`).ok).toBe(true);
    const wrapped = parseMcpServer(`{"mcpServers":{"gh":{"command":"node","args":["s.js"]}}}`);
    expect(wrapped.result.ok).toBe(true);
    expect(wrapped.entry).toMatchObject({ command: "node" });
  });
  it("rejects invalid JSON, missing command/url, both, and bad args", () => {
    expect(validateMcpServer("not json").ok).toBe(false);
    expect(validateMcpServer("{}").ok).toBe(false);
    expect(validateMcpServer(`{"command":"a","url":"https://b"}`).ok).toBe(false);
    expect(validateMcpServer(`{"command":"a","args":"not-array"}`).ok).toBe(false);
    expect(validateMcpServer(`{"url":"ftp://x"}`).ok).toBe(false);
  });
  it("refuses env values that look like real credentials and points at local env", () => {
    const { result } = parseMcpServer(
      `{"command":"npx","env":{"GITHUB_TOKEN":"ghp_${"a1".repeat(12)}"}}`,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/local environment/);
    // Same filter applies to remote headers.
    expect(
      validateMcpServer(`{"url":"https://x.example","headers":{"authorization":"Bearer sk-abc123def456ghi789"}}`).ok,
    ).toBe(false);
  });
});

describe("secret detection", () => {
  it("flags known key shapes regardless of key name", () => {
    expect(looksLikeSecretValue("anything", "sk-abcdef123456789012")).toBe(true);
    expect(looksLikeSecretValue("x", "AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksLikeSecretValue("x", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx")).toBe(true);
  });
  it("flags secret-named keys with concrete opaque values but allows placeholders", () => {
    expect(looksLikeSecretValue("API_KEY", "9f8e7d6c5b4a39281706")).toBe(true);
    expect(looksLikeSecretValue("API_KEY", "${API_KEY}")).toBe(false);
    expect(looksLikeSecretValue("API_KEY", "YOUR_KEY_HERE")).toBe(false);
    expect(looksLikeSecretValue("PATH_PREFIX", "/usr/local/bin")).toBe(false);
  });
});

describe("permissions", () => {
  it("accepts allow/deny/ask arrays with Tool(specifier) and mcp rules, and unwraps {permissions:...}", () => {
    expect(
      validatePermissions(`{"allow":["Bash(./gradlew build)","Read"],"deny":["Bash(rm -rf *)"],"ask":["mcp__github__create_issue"]}`).ok,
    ).toBe(true);
    const { permissions } = parsePermissions(`{"permissions":{"allow":["Read"]}}`);
    expect(permissions).toEqual({ allow: ["Read"] });
  });
  it("rejects unknown keys, non-array lists, empty snippets, and junk rules", () => {
    expect(validatePermissions(`{"allowAll":true}`).ok).toBe(false);
    expect(validatePermissions(`{"allow":"Read"}`).ok).toBe(false);
    expect(validatePermissions(`{}`).ok).toBe(false);
    expect(validatePermissions(`{"allow":["not a rule!!"]}`).ok).toBe(false);
  });
});

describe("skill", () => {
  it("accepts SKILL.md frontmatter + body", () => {
    expect(
      validateSkill(`---\nname: match-strategy-notes\ndescription: How we write notes\n---\n\nInstructions.`).ok,
    ).toBe(true);
  });
  it("rejects missing description or empty body", () => {
    expect(validateSkill(`---\nname: x\n---\nbody`).ok).toBe(false);
    expect(validateSkill(`---\nname: x\ndescription: d\n---\n`).ok).toBe(false);
  });
});

describe("dispatcher", () => {
  it("routes by kind and enforces the global size cap", () => {
    expect(validateAgentConfigContent("rules", "- rule").ok).toBe(true);
    expect(validateAgentConfigContent("permissions", `{"allow":["Read"]}`).ok).toBe(true);
    expect(validateAgentConfigContent("rules", "x".repeat(70000)).ok).toBe(false);
  });
});
