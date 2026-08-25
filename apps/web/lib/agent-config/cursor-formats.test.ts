import { describe, expect, it } from "vitest";
import {
  CURSOR_GENERATED_BANNER,
  CURSOR_MCP_PREFIX,
  CURSOR_RULES_DIR,
  CURSOR_SKILLS_DIR,
  buildCursorExport,
  buildCursorMcpServers,
  buildCursorRuleMdc,
  cursorSkillFolder,
} from "./cursor-formats";
import type { AgentConfigBundle } from "./store";

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

describe("buildCursorRuleMdc", () => {
  it("writes a team-wide rule as an alwaysApply .mdc with the item description", () => {
    const file = buildCursorRuleMdc({
      name: "units",
      description: "Units policy",
      markdown: "- Always use meters.",
    });
    expect(file).not.toBeNull();
    expect(file!.filename).toBe("units.mdc");
    // MDC frontmatter shape per https://cursor.com/docs/context/rules
    expect(file!.content).toBe(
      `---\ndescription: "Units policy"\nalwaysApply: true\n---\n\n${CURSOR_GENERATED_BANNER}\n\n- Always use meters.\n`,
    );
  });

  it("turns declared path scopes into comma-separated globs with alwaysApply false", () => {
    const file = buildCursorRuleMdc({
      name: "drivetrain",
      description: null,
      markdown: `---\ndescription: Drivetrain conventions\nglobs:\n  - src/main/**/*.java\n  - "**/*Drive*.java"\n---\n- SparkMax current limits are mandatory.`,
    });
    expect(file!.content).toContain('description: "Drivetrain conventions"');
    expect(file!.content).toContain("globs: src/main/**/*.java,**/*Drive*.java");
    expect(file!.content).toContain("alwaysApply: false");
    // Scope frontmatter is metadata, not body.
    expect(file!.content).not.toContain("---\ndescription: Drivetrain conventions");
    expect(file!.content.trim().endsWith("- SparkMax current limits are mandatory.")).toBe(true);
  });

  it("lets an explicit alwaysApply declaration win over the globs default", () => {
    const file = buildCursorRuleMdc({
      name: "everywhere",
      description: null,
      markdown: `---\nglobs: src/**\nalwaysApply: true\n---\nbody`,
    });
    expect(file!.content).toContain("globs: src/**");
    expect(file!.content).toContain("alwaysApply: true");
  });

  it("omits description when none exists and quotes YAML-hostile text when it does", () => {
    const bare = buildCursorRuleMdc({ name: "r", description: null, markdown: "body" });
    expect(bare!.content).not.toContain("description:");
    const hostile = buildCursorRuleMdc({
      name: "r",
      description: 'Use "meters": always',
      markdown: "body",
    });
    expect(hostile!.content).toContain('description: "Use \\"meters\\": always"');
  });

  it("refuses unsafe names and empty bodies instead of writing junk files", () => {
    expect(buildCursorRuleMdc({ name: "../escape", description: null, markdown: "x" })).toBeNull();
    expect(buildCursorRuleMdc({ name: "ok", description: null, markdown: "   " })).toBeNull();
    expect(
      buildCursorRuleMdc({ name: "ok", description: null, markdown: "---\nglobs: src/**\n---\n  " }),
    ).toBeNull();
  });
});

describe("cursorSkillFolder", () => {
  it("prefers the SKILL.md frontmatter name (Cursor requires folder == name)", () => {
    expect(
      cursorSkillFolder("---\nname: match-notes\ndescription: d\n---\nbody", "different-item-name"),
    ).toBe("match-notes");
  });
  it("falls back to the item name when frontmatter is missing or unsafe", () => {
    expect(cursorSkillFolder("no frontmatter", "item-name")).toBe("item-name");
    expect(cursorSkillFolder("---\nname: Bad Name\ndescription: d\n---\nbody", "item-name")).toBe("item-name");
    expect(cursorSkillFolder("no frontmatter", "BAD NAME")).toBeNull();
  });
});

describe("buildCursorMcpServers", () => {
  it("namespaces entries under the vantage- prefix and drops unsafe names", () => {
    const servers = buildCursorMcpServers([
      { name: "github", description: null, entry: { command: "npx", args: ["-y", "srv"] }, version: 1 },
      { name: "../evil", description: null, entry: { command: "x" }, version: 1 },
    ]);
    expect(Object.keys(servers)).toEqual([`${CURSOR_MCP_PREFIX}github`]);
    expect(servers["vantage-github"]).toEqual({ command: "npx", args: ["-y", "srv"] });
  });
});

describe("buildCursorExport", () => {
  it("materializes rules, skills, and mcp servers and honestly skips the rest", () => {
    const out = buildCursorExport(
      bundleWith({
        rules: [{ name: "units", description: "Units", markdown: "- meters only", version: 1 }],
        skills: [
          { name: "notes", description: null, markdown: "---\nname: notes\ndescription: d\n---\nbody", version: 1 },
        ],
        subagents: [{ name: "reviewer", description: null, markdown: "---\nname: reviewer\ndescription: d\n---\np", version: 1 }],
        permissions: [{ name: "gradle", description: null, snippet: { allow: ["Read"] }, version: 1 }],
        mcpServers: [{ name: "github", description: null, entry: { command: "npx" }, version: 1 }],
      }),
    );
    expect(Object.keys(out.files).sort()).toEqual([
      `${CURSOR_RULES_DIR}/units.mdc`,
      `${CURSOR_SKILLS_DIR}/notes/SKILL.md`,
    ]);
    expect(out.files[`${CURSOR_SKILLS_DIR}/notes/SKILL.md`]).toBe("---\nname: notes\ndescription: d\n---\nbody\n");
    expect(out.mcpServers["vantage-github"]).toEqual({ command: "npx" });
    expect(out.skipped).toEqual([
      { kind: "subagent", name: "reviewer", reason: "no Cursor equivalent" },
      { kind: "permissions", name: "gradle", reason: "no Cursor equivalent" },
    ]);
  });

  it("exports nothing (not fabricated files) for an empty bundle", () => {
    const out = buildCursorExport(bundleWith({}));
    expect(out.files).toEqual({});
    expect(out.mcpServers).toEqual({});
    expect(out.skipped).toEqual([]);
  });
});
