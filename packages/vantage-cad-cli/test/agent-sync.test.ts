import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURSOR_GENERATED_BANNER,
  VANTAGE_BEGIN_MARKER,
  VANTAGE_END_MARKER,
  applyVantageMarkerBlock,
  buildClaudeMdBlock,
  buildCursorRuleMdc,
  buildPermissionsSuggestion,
  buildTeamRulesMarkdown,
  cursorSkillFolder,
  mergeMcpServers,
  parseAgentTargets,
  parseRuleScope,
  pruneManagedMdcDir,
  safeConfigName,
  type AgentConfigBundle,
} from "../src/agent-sync";

function bundleWith(partial: Partial<AgentConfigBundle>): AgentConfigBundle {
  return {
    schema: "vantage.agent-config/v1",
    orgId: "org-1",
    generatedAt: "2026-08-24T00:00:00.000Z",
    rules: [],
    subagents: [],
    mcpServers: [],
    permissions: [],
    skills: [],
    ...partial,
  };
}

describe("CLAUDE.md marker block", () => {
  const block = buildClaudeMdBlock();

  it("appends the marked block to an existing CLAUDE.md without touching its content", () => {
    const existing = "# My robot code\n\nLocal conventions here.\n";
    const next = applyVantageMarkerBlock(existing, block);
    expect(next.startsWith("# My robot code")).toBe(true);
    expect(next).toContain(VANTAGE_BEGIN_MARKER);
    expect(next).toContain("@.claude/vantage-team-rules.md");
    expect(next.indexOf("Local conventions here.")).toBeGreaterThan(-1);
  });

  it("is idempotent: syncing twice equals syncing once", () => {
    const existing = "# Repo\n\ntext above\n";
    const once = applyVantageMarkerBlock(existing, block);
    const twice = applyVantageMarkerBlock(once, block);
    expect(twice).toBe(once);
    expect(twice.split(VANTAGE_BEGIN_MARKER)).toHaveLength(2); // exactly one block
  });

  it("replaces only the marked region, preserving text before AND after the markers", () => {
    const existing = `before\n\n${VANTAGE_BEGIN_MARKER}\nold stale content\n${VANTAGE_END_MARKER}\n\nafter the block\n`;
    const next = applyVantageMarkerBlock(existing, block);
    expect(next).not.toContain("old stale content");
    expect(next.startsWith("before\n")).toBe(true);
    expect(next).toContain("after the block");
  });

  it("handles an empty/missing CLAUDE.md", () => {
    const next = applyVantageMarkerBlock("", block);
    expect(next.startsWith(VANTAGE_BEGIN_MARKER)).toBe(true);
    expect(next.endsWith(`${VANTAGE_END_MARKER}\n`)).toBe(true);
  });

  it("refuses a corrupt half-present marker pair instead of guessing", () => {
    expect(() => applyVantageMarkerBlock(`x\n${VANTAGE_BEGIN_MARKER}\ny`, block)).toThrow(/corrupt/i);
    expect(() => applyVantageMarkerBlock(`x\n${VANTAGE_END_MARKER}\ny`, block)).toThrow(/corrupt/i);
  });
});

describe(".mcp.json merge", () => {
  const servers: AgentConfigBundle["mcpServers"] = [
    { name: "github", description: null, entry: { command: "npx", args: ["-y", "srv"] }, version: 1 },
  ];

  it("adds team servers under the vantage- prefix and never clobbers foreign keys", () => {
    const existing = JSON.stringify({
      mcpServers: { "my-local-tool": { command: "node", args: ["tool.js"] } },
      otherTopLevelKey: { keep: true },
    });
    const merged = mergeMcpServers(existing, servers);
    const parsed = JSON.parse(merged.json) as {
      mcpServers: Record<string, unknown>;
      otherTopLevelKey: unknown;
    };
    expect(parsed.mcpServers["my-local-tool"]).toEqual({ command: "node", args: ["tool.js"] });
    expect(parsed.mcpServers["vantage-github"]).toEqual({ command: "npx", args: ["-y", "srv"] });
    expect(parsed.otherTopLevelKey).toEqual({ keep: true });
    expect(merged.added).toEqual(["vantage-github"]);
  });

  it("updates changed vantage- entries, reports unchanged ones, and is idempotent", () => {
    const first = mergeMcpServers(null, servers);
    const second = mergeMcpServers(first.json, servers);
    expect(second.added).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.unchanged).toEqual(["vantage-github"]);
    expect(second.json).toBe(first.json);
    const changed = mergeMcpServers(first.json, [
      { ...servers[0]!, entry: { command: "node", args: ["other.js"] } },
    ]);
    expect(changed.updated).toEqual(["vantage-github"]);
  });

  it("prunes stale vantage- keys but ONLY inside the vantage namespace", () => {
    const existing = JSON.stringify({
      mcpServers: {
        "vantage-old-server": { command: "gone" },
        "team-owned": { command: "stays" },
      },
    });
    const merged = mergeMcpServers(existing, servers);
    const parsed = JSON.parse(merged.json) as { mcpServers: Record<string, unknown> };
    expect(merged.removed).toEqual(["vantage-old-server"]);
    expect(parsed.mcpServers["team-owned"]).toEqual({ command: "stays" });
    expect(parsed.mcpServers["vantage-github"]).toBeDefined();
  });

  it("refuses a corrupt .mcp.json rather than overwriting it", () => {
    expect(() => mergeMcpServers("[]", servers)).toThrow(/not a JSON object/);
    expect(() => mergeMcpServers("{nope", servers)).toThrow();
  });
});

describe("rules + permissions artifacts", () => {
  it("concatenates rules with headers and a do-not-edit banner", () => {
    const markdown = buildTeamRulesMarkdown(
      bundleWith({
        rules: [
          { name: "units", description: null, markdown: "- meters only", version: 1 },
          { name: "naming", description: null, markdown: "- <X>Subsystem", version: 2 },
        ],
      }),
    );
    expect(markdown).toContain("## units");
    expect(markdown).toContain("## naming");
    expect(markdown).toContain("edit at /team/agent-config");
    expect(buildTeamRulesMarkdown(bundleWith({}))).toBeNull();
  });

  it("builds a suggestion file (never an automatic settings merge) with deduped sorted rules", () => {
    const suggestion = buildPermissionsSuggestion(
      bundleWith({
        permissions: [
          { name: "a", description: null, snippet: { allow: ["Read", "Bash(./gradlew build)"] }, version: 1 },
          { name: "b", description: null, snippet: { allow: ["Read"], deny: ["Bash(rm -rf *)"] }, version: 1 },
        ],
      }),
    );
    expect(suggestion).not.toBeNull();
    const parsed = JSON.parse(suggestion!) as { note: string; permissions: { allow: string[]; deny: string[] } };
    expect(parsed.permissions.allow).toEqual(["Bash(./gradlew build)", "Read"]);
    expect(parsed.permissions.deny).toEqual(["Bash(rm -rf *)"]);
    expect(parsed.note).toMatch(/never applies it automatically/i);
    expect(buildPermissionsSuggestion(bundleWith({}))).toBeNull();
  });
});

describe("name safety", () => {
  it("only passes filename-safe slugs through to disk paths", () => {
    expect(safeConfigName("drivetrain-reviewer")).toBe("drivetrain-reviewer");
    expect(safeConfigName("../escape")).toBeNull();
    expect(safeConfigName("UPPER")).toBeNull();
    expect(safeConfigName("")).toBeNull();
  });
});

describe("rule scope frontmatter", () => {
  it("strips the optional Cursor scope frontmatter from the Claude rules file", () => {
    const markdown = buildTeamRulesMarkdown(
      bundleWith({
        rules: [
          {
            name: "drivetrain",
            description: null,
            markdown: `---\nglobs: src/main/**/*.java\n---\n- SparkMax limits.`,
            version: 1,
          },
        ],
      }),
    );
    expect(markdown).toContain("## drivetrain");
    expect(markdown).toContain("- SparkMax limits.");
    expect(markdown).not.toContain("globs:");
  });

  it("parses comma-separated and block-list globs identically", () => {
    expect(parseRuleScope(`---\nglobs: src/**, "**/*.java"\n---\nbody`).globs).toEqual([
      "src/**",
      "**/*.java",
    ]);
    expect(parseRuleScope(`---\nglobs:\n  - src/**\n  - "**/*.java"\n---\nbody`).globs).toEqual([
      "src/**",
      "**/*.java",
    ]);
    expect(parseRuleScope("plain markdown").globs).toBeNull();
  });
});

describe("Cursor .mdc writer", () => {
  it("writes a team-wide rule as alwaysApply with description and banner", () => {
    const file = buildCursorRuleMdc({
      name: "units",
      description: "Units policy",
      markdown: "- Always use meters.",
    });
    expect(file).toEqual({
      filename: "units.mdc",
      content: `---\ndescription: "Units policy"\nalwaysApply: true\n---\n\n${CURSOR_GENERATED_BANNER}\n\n- Always use meters.\n`,
    });
  });

  it("maps declared globs to an Auto Attached rule (alwaysApply false)", () => {
    const file = buildCursorRuleMdc({
      name: "drivetrain",
      description: null,
      markdown: `---\ndescription: Drivetrain conventions\nglobs: src/main/**/*.java\n---\n- SparkMax limits.`,
    });
    expect(file!.content).toContain("globs: src/main/**/*.java");
    expect(file!.content).toContain("alwaysApply: false");
    expect(file!.content).toContain('description: "Drivetrain conventions"');
    expect(file!.content.trim().endsWith("- SparkMax limits.")).toBe(true);
  });

  it("refuses unsafe names and empty bodies", () => {
    expect(buildCursorRuleMdc({ name: "../x", description: null, markdown: "y" })).toBeNull();
    expect(buildCursorRuleMdc({ name: "ok", description: null, markdown: "  " })).toBeNull();
  });
});

describe("Cursor skill folder", () => {
  it("uses the SKILL.md frontmatter name (folder must match it) with item-name fallback", () => {
    expect(cursorSkillFolder("---\nname: match-notes\ndescription: d\n---\nbody", "item")).toBe("match-notes");
    expect(cursorSkillFolder("no frontmatter", "item")).toBe("item");
    expect(cursorSkillFolder("---\nname: Bad Name\n---\nbody", "item")).toBe("item");
    expect(cursorSkillFolder("no frontmatter", "BAD")).toBeNull();
  });
});

describe("agent targets", () => {
  it("honors the explicit --agent flag", () => {
    expect(parseAgentTargets("claude", { claude: false, cursor: true })).toMatchObject({
      claude: true,
      cursor: false,
      source: "flag",
    });
    expect(parseAgentTargets("cursor", { claude: true, cursor: false })).toMatchObject({
      claude: false,
      cursor: true,
    });
    expect(parseAgentTargets("all", { claude: false, cursor: false })).toMatchObject({
      claude: true,
      cursor: true,
    });
  });
  it("defaults to what the repo already uses, and to Claude when nothing is detected", () => {
    expect(parseAgentTargets(null, { claude: true, cursor: true })).toMatchObject({
      claude: true,
      cursor: true,
      source: "detected",
    });
    expect(parseAgentTargets(null, { claude: false, cursor: true })).toMatchObject({
      claude: false,
      cursor: true,
      source: "detected",
    });
    expect(parseAgentTargets(null, { claude: false, cursor: false })).toMatchObject({
      claude: true,
      cursor: false,
      source: "default",
    });
  });
  it("rejects unknown --agent values", () => {
    expect(() => parseAgentTargets("vscode", { claude: false, cursor: false })).toThrow(/claude, cursor, or all/);
  });
});

describe(".cursor/mcp.json merge", () => {
  it("uses the same namespaced merge with the Cursor file name in errors", () => {
    expect(() => mergeMcpServers("[]", [], ".cursor/mcp.json")).toThrow(/\.cursor\/mcp\.json exists but is not/);
    // Idempotent re-merge, same as .mcp.json.
    const servers: AgentConfigBundle["mcpServers"] = [
      { name: "github", description: null, entry: { command: "npx" }, version: 1 },
    ];
    const first = mergeMcpServers(null, servers, ".cursor/mcp.json");
    const second = mergeMcpServers(first.json, servers, ".cursor/mcp.json");
    expect(second.json).toBe(first.json);
    expect(second.unchanged).toEqual(["vantage-github"]);
  });
});

describe("managed .mdc pruning", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("removes stale generated files but NEVER user-authored ones, and is dry-run aware", async () => {
    dir = await mkdtemp(join(tmpdir(), "vantage-mdc-"));
    const generated = `---\nalwaysApply: true\n---\n\n${CURSOR_GENERATED_BANNER}\n\nold rule\n`;
    await writeFile(join(dir, "stale.mdc"), generated, "utf8");
    await writeFile(join(dir, "kept.mdc"), generated, "utf8");
    await writeFile(join(dir, "user-authored.mdc"), "---\nalwaysApply: true\n---\nmy own rule\n", "utf8");
    await writeFile(join(dir, "notes.md"), "not an mdc file", "utf8");

    const dry = await pruneManagedMdcDir(dir, new Set(["kept.mdc"]), true);
    expect(dry.pruned).toEqual(["stale.mdc"]);
    expect(dry.kept).toEqual(["user-authored.mdc"]);
    expect((await readdir(dir)).sort()).toEqual(["kept.mdc", "notes.md", "stale.mdc", "user-authored.mdc"]);

    const real = await pruneManagedMdcDir(dir, new Set(["kept.mdc"]), false);
    expect(real.pruned).toEqual(["stale.mdc"]);
    expect((await readdir(dir)).sort()).toEqual(["kept.mdc", "notes.md", "user-authored.mdc"]);
    expect(await readFile(join(dir, "user-authored.mdc"), "utf8")).toContain("my own rule");

    // Re-prune after convergence is a no-op (idempotent re-sync).
    const again = await pruneManagedMdcDir(dir, new Set(["kept.mdc"]), false);
    expect(again.pruned).toEqual([]);
  });

  it("returns empty results for a missing directory instead of failing", async () => {
    const result = await pruneManagedMdcDir(join(tmpdir(), "vantage-mdc-none-such"), new Set(), false);
    expect(result).toEqual({ pruned: [], kept: [] });
  });
});
