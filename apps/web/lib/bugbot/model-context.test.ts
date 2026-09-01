import { describe, expect, it } from "vitest";
import { BUGBOT_FILE_CAP } from "./file-cap";
import {
  assertBugbotModelContext,
  buildBugbotModelContext,
  cappedBugbotContextFiles,
  loadBugbotContextSources,
} from "./model-context";

const SHA = "a".repeat(40);

describe("buildBugbotModelContext", () => {
  it("never returns an empty context array", () => {
    const emptyish = [
      buildBugbotModelContext({}),
      buildBugbotModelContext({ files: [], priorFindings: [], knowledge: "  ", fmea: [] }),
      buildBugbotModelContext({ files: [{ path: "empty.java", content: "   " }] }),
    ];
    for (const items of emptyish) {
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((item) => item.id === "bugbot-coverage")).toBe(true);
      expect(items.filter((item) => item.type === "github_file")).toHaveLength(0);
      expect(() => assertBugbotModelContext(items)).not.toThrow();
    }
    expect(emptyish[0]?.[0]?.content).toMatch(/Do not invent DEMO bugs/i);
  });

  it("caps files and still includes prior findings, knowledge, and FMEA", () => {
    const files = Array.from({ length: BUGBOT_FILE_CAP + 2 }, (_, index) => ({
      path: `src/File${index}.java`,
      content: `class File${index} {}`,
    }));
    const items = buildBugbotModelContext({
      files,
      githubRepo: "team/robot",
      githubSha: SHA,
      priorFindings: [{ filePath: "src/File0.java", finding: "CAN id 3 used twice", evidence: "new TalonFX(3)", severity: "high" }],
      knowledge: "Swerve uses Phoenix 6. Supply current limit is 40 A.",
      fmea: [{ subsystem: "drive", title: "Brownout on climb", failureMode: "four modules at 1.0" }],
    });
    expect(items.filter((item) => item.type === "github_file")).toHaveLength(BUGBOT_FILE_CAP);
    expect(items.find((item) => item.id === "bugbot-coverage")?.content).toMatch(/Deferred past the file-cap: 2/);
    expect(items.find((item) => item.id === "bugbot-prior-findings")?.content).toMatch(/CAN id 3/);
    expect(items.find((item) => item.id === "bugbot-team-knowledge")?.content).toMatch(/Phoenix 6/);
    expect(items.find((item) => item.id === "bugbot-fmea")?.content).toMatch(/Brownout on climb/);
    expect(() => assertBugbotModelContext(items)).not.toThrow();
  });

  it("includes written custom instructions and a real repo overview only", () => {
    const items = buildBugbotModelContext({
      customInstructions: "Never retune CAN id 3.",
      repoOverview: "Repo team/robot\nLanguages seen: Java",
    });
    expect(items.find((item) => item.id === "bugbot-custom-instructions")?.content).toMatch(/CAN id 3/);
    expect(items.find((item) => item.id === "bugbot-repo-overview")?.content).toMatch(/Languages seen: Java/);
    expect(buildBugbotModelContext({ customInstructions: "   " }).some((item) => item.id === "bugbot-custom-instructions")).toBe(
      false,
    );
  });

  it("refuses an empty context array at the assert", () => {
    expect(() => assertBugbotModelContext([])).toThrow(/empty model context/i);
    expect(() => assertBugbotModelContext(null)).toThrow(/empty model context/i);
    expect(() => assertBugbotModelContext(undefined)).toThrow(/empty model context/i);
  });

  it("refuses to cap a file list down to nothing when the caller needs files", () => {
    expect(() => cappedBugbotContextFiles([])).toThrow(/file-cap left no robot-code files/i);
  });
});

describe("loadBugbotContextSources", () => {
  it("skips disabled knowledge and loads open findings plus FMEA", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM team_knowledge")) {
          return { rows: [{ content: "  ", enabled: true }] };
        }
        if (sql.includes("FROM code_bugbot_findings")) {
          return { rows: [{ filePath: "Drive.java", finding: "duplicate CAN", evidence: "TalonFX(3)", severity: "high" }] };
        }
        if (sql.includes("FROM fmea_failures")) {
          return { rows: [{ subsystem: "drive", title: "Brownout", failureMode: "full output" }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
    const loaded = await loadBugbotContextSources(client as never, {
      orgId: "aaaaaaaa-1111-4111-8111-111111111111",
      scopeKey: "github:team/robot",
    });
    expect(loaded.knowledge).toBeNull();
    expect(loaded.priorFindings).toHaveLength(1);
    expect(loaded.fmea[0]?.title).toBe("Brownout");
    expect(queries.some((sql) => sql.includes("code_bugbot_findings"))).toBe(true);
  });

  it("does not query prior findings without a scope key", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM team_knowledge")) return { rows: [{ content: "Phoenix 6", enabled: false }] };
        if (sql.includes("FROM fmea_failures")) return { rows: [] };
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
    const loaded = await loadBugbotContextSources(client as never, {
      orgId: "aaaaaaaa-1111-4111-8111-111111111111",
    });
    expect(loaded.knowledge).toBeNull();
    expect(loaded.priorFindings).toEqual([]);
    expect(queries.some((sql) => sql.includes("code_bugbot_findings"))).toBe(false);
  });
});
