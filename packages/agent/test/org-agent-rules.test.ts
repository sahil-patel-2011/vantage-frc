import { describe, expect, it, vi } from "vitest";
import {
  ORG_AGENT_RULES_HEADER,
  buildOrgAgentRulesContextItem,
  formatOrgAgentRules,
  loadOrgAgentRules,
  loadOrgAgentRulesContextItem,
} from "../src/org-agent-rules";

describe("formatOrgAgentRules", () => {
  it("returns null when there are no real rules (honest empty state)", () => {
    expect(formatOrgAgentRules([])).toBeNull();
    expect(formatOrgAgentRules([{ name: "blank", markdown: "   \n" }])).toBeNull();
  });

  it("labels the section and keeps whole items in order", () => {
    const content = formatOrgAgentRules([
      { name: "units", markdown: "- meters only" },
      { name: "naming", markdown: "- <X>Subsystem" },
    ]);
    expect(content).not.toBeNull();
    expect(content!.startsWith(ORG_AGENT_RULES_HEADER)).toBe(true);
    expect(content!.indexOf("## units")).toBeLessThan(content!.indexOf("## naming"));
  });

  it("bounds total size: drops whole items past the budget instead of growing unbounded", () => {
    const rules = [
      { name: "a-first", markdown: "x".repeat(90) },
      { name: "b-second", markdown: "y".repeat(90) },
      { name: "c-third", markdown: "z".repeat(90) },
    ];
    const content = formatOrgAgentRules(rules, 220);
    expect(content).toContain("## a-first");
    expect(content).toContain("## b-second");
    expect(content).not.toContain("## c-third");
  });

  it("clips a single oversized item rather than dropping everything", () => {
    const content = formatOrgAgentRules([{ name: "huge", markdown: "x".repeat(50_000) }], 200);
    expect(content).not.toBeNull();
    expect(content!.length).toBeLessThanOrEqual(ORG_AGENT_RULES_HEADER.length + 2 + 202);
    expect(content).toContain("…");
  });
});

describe("buildOrgAgentRulesContextItem", () => {
  it("builds a provenance-tracked team_memory context source", () => {
    const item = buildOrgAgentRulesContextItem([{ name: "units", markdown: "- meters only" }]);
    expect(item).toMatchObject({
      type: "team_memory",
      id: "org-agent-rules",
      classification: "team_memory",
      label: "Team agent rules (/team/agent-config)",
    });
    expect(item!.importance).toBeGreaterThan(0);
    expect(item!.content).toContain("/team/agent-config");
  });

  it("returns null instead of an empty item", () => {
    expect(buildOrgAgentRulesContextItem([])).toBeNull();
  });
});

type SeededRule = {
  name: string;
  markdown: string;
  visibility?: "team" | "members";
  createdBy?: string;
  grantedTo?: string[];
};

/**
 * Fake agent_config_items database. It answers the schema probe from the flags, then
 * serves the rules query by applying ONLY the visibility branches the SQL actually
 * contains — a query with no per-user predicate therefore sees every row of the org,
 * exactly like the owner/admin RLS policy on a real database.
 */
function agentConfigClient(options: {
  items?: boolean;
  sharing?: boolean;
  rules: SeededRule[];
}) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("to_regclass")) {
        const rows = [
          { itemsPresent: options.items ?? true, sharingPresent: options.sharing ?? true },
        ];
        return { rows, rowCount: rows.length };
      }
      const viewer = params[1] ?? null;
      const scoped = sql.includes("i.visibility = 'team'");
      const visible = scoped
        ? options.rules.filter(
            (rule) =>
              (rule.visibility ?? "team") === "team" ||
              (sql.includes("i.created_by = $2::uuid") && rule.createdBy === viewer) ||
              (sql.includes("FROM agent_config_item_grants g") &&
                (rule.grantedTo ?? []).includes(viewer as string)),
          )
        : options.rules;
      const rows = visible.map((rule) => ({ name: rule.name, markdown: rule.markdown }));
      return { rows, rowCount: rows.length };
    }),
  };
}

const SHARED_RULES: SeededRule[] = [
  { name: "a-units", markdown: "- meters only", visibility: "team", createdBy: "user-admin" },
  { name: "b-mine", markdown: "- my own draft prompt", visibility: "members", createdBy: "user-me" },
  {
    name: "c-granted",
    markdown: "- shared with me directly",
    visibility: "members",
    createdBy: "user-other",
    grantedTo: ["user-me"],
  },
  {
    name: "d-theirs",
    markdown: "- another member's private notes",
    visibility: "members",
    createdBy: "user-other",
  },
];

describe("loadOrgAgentRules visibility scoping (migration 0490)", () => {
  it("includes team-wide, own, and granted rules for the requesting member", async () => {
    const client = agentConfigClient({ rules: SHARED_RULES });
    const rules = await loadOrgAgentRules(client as never, "org-1", "user-me");
    expect(rules.map((rule) => rule.name)).toEqual(["a-units", "b-mine", "c-granted"]);
  });

  it("excludes another member's restricted rules even for an admin who can SELECT them", async () => {
    const client = agentConfigClient({ rules: SHARED_RULES });
    const rules = await loadOrgAgentRules(client as never, "org-1", "user-admin");
    expect(rules.map((rule) => rule.name)).toEqual(["a-units"]);
    expect(JSON.stringify(rules)).not.toContain("another member's private notes");
  });

  it("scopes with bound parameters, never string-concatenated ids", async () => {
    const client = agentConfigClient({ rules: SHARED_RULES });
    await loadOrgAgentRules(client as never, "org-1", "user-me");
    const [sql, params] = client.query.mock.calls.at(-1)!;
    expect(sql).toContain("$1::uuid");
    expect(sql).toContain("$2::uuid");
    expect(sql).not.toContain("user-me");
    expect(params).toEqual(["org-1", "user-me"]);
  });

  it("degrades to team-wide rules on a database where 0490 has not run", async () => {
    const client = agentConfigClient({
      sharing: false,
      rules: [
        { name: "a-units", markdown: "- meters only" },
        { name: "b-naming", markdown: "- <X>Subsystem" },
      ],
    });
    const rules = await loadOrgAgentRules(client as never, "org-1", "user-me");
    expect(rules.map((rule) => rule.name)).toEqual(["a-units", "b-naming"]);
    const [sql] = client.query.mock.calls.at(-1)!;
    expect(sql).not.toContain("visibility");
    expect(sql).not.toContain("agent_config_item_grants");
  });

  it("returns nothing at all when agent_config_items does not exist yet (pre-0487)", async () => {
    const client = agentConfigClient({ items: false, sharing: false, rules: SHARED_RULES });
    expect(await loadOrgAgentRules(client as never, "org-1", "user-me")).toEqual([]);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("threads the user through the context-item convenience seam", async () => {
    const client = agentConfigClient({ rules: SHARED_RULES });
    const item = await loadOrgAgentRulesContextItem(client as never, "org-1", "user-admin");
    expect(item!.content).toContain("## a-units");
    expect(item!.content).not.toContain("another member's private notes");
  });
});
