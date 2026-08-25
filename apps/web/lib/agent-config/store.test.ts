import { describe, expect, it } from "vitest";
import {
  bundleRowVisibleToUser,
  filterBundleRowsForUser,
  shapeAgentConfigBundle,
  type ScopedBundleRow,
} from "./store";

const now = () => new Date("2026-08-24T00:00:00.000Z");

describe("shapeAgentConfigBundle", () => {
  it("produces the documented v1 shape with only format-valid rows", () => {
    const bundle = shapeAgentConfigBundle(
      "org-1",
      [
        { kind: "rules", name: "units", description: null, content: "- meters only", version: 3, formatValid: true },
        { kind: "rules", name: "broken", description: null, content: "", version: 1, formatValid: false },
        {
          kind: "subagent",
          name: "reviewer",
          description: "Reviews code",
          content: "---\nname: reviewer\ndescription: d\n---\nprompt",
          version: 2,
          formatValid: true,
        },
        {
          kind: "mcp-server",
          name: "github",
          description: null,
          content: `{"mcpServers":{"gh":{"command":"npx","args":["-y","srv"]}}}`,
          version: 1,
          formatValid: true,
        },
        {
          kind: "permissions",
          name: "gradle",
          description: null,
          content: `{"permissions":{"allow":["Bash(./gradlew build)"]}}`,
          version: 1,
          formatValid: true,
        },
        {
          kind: "skill",
          name: "notes",
          description: null,
          content: "---\nname: notes\ndescription: d\n---\nbody",
          version: 1,
          formatValid: true,
        },
      ],
      now,
    );

    expect(bundle.schema).toBe("vantage.agent-config/v1");
    expect(bundle.orgId).toBe("org-1");
    expect(bundle.generatedAt).toBe("2026-08-24T00:00:00.000Z");
    expect(bundle.rules).toEqual([
      { name: "units", description: null, markdown: "- meters only", version: 3 },
    ]);
    expect(bundle.subagents).toHaveLength(1);
    expect(bundle.skills).toHaveLength(1);
    // JSON kinds are parsed and normalized: the pasted mcpServers wrapper becomes the bare entry.
    expect(bundle.mcpServers).toEqual([
      { name: "github", description: null, version: 1, entry: { command: "npx", args: ["-y", "srv"] } },
    ]);
    expect(bundle.permissions).toEqual([
      { name: "gradle", description: null, version: 1, snippet: { allow: ["Bash(./gradlew build)"] } },
    ]);
  });

  it("returns honest empty arrays when nothing is shared", () => {
    const bundle = shapeAgentConfigBundle("org-1", [], now);
    expect(bundle.rules).toEqual([]);
    expect(bundle.mcpServers).toEqual([]);
  });
});

describe("bundle sharing scopes (migration 0490)", () => {
  const row = (partial: Partial<ScopedBundleRow>): ScopedBundleRow => ({
    kind: "rules",
    name: "r",
    description: null,
    content: "- rule",
    version: 1,
    formatValid: true,
    visibility: "team",
    createdBy: "creator",
    sharedWith: [],
    ...partial,
  });

  it("team items are visible to every member", () => {
    expect(bundleRowVisibleToUser(row({}), "anyone")).toBe(true);
  });

  it("members items are visible only to creator and granted users — including admins' bundles", () => {
    const restricted = row({ visibility: "members", createdBy: "creator", sharedWith: ["grantee"] });
    expect(bundleRowVisibleToUser(restricted, "creator")).toBe(true);
    expect(bundleRowVisibleToUser(restricted, "grantee")).toBe(true);
    expect(bundleRowVisibleToUser(restricted, "other-member")).toBe(false);
    // No admin exception here: management visibility is an RLS/UI concern, the
    // sync bundle stays personal.
    expect(bundleRowVisibleToUser(restricted, "admin-user")).toBe(false);
  });

  it("filters a mixed row set down to the member's personal bundle", () => {
    const rows = [
      row({ name: "team-wide" }),
      row({ name: "mine", visibility: "members", createdBy: "me" }),
      row({ name: "granted", visibility: "members", createdBy: "creator", sharedWith: ["me", "other"] }),
      row({ name: "not-mine", visibility: "members", createdBy: "creator", sharedWith: ["other"] }),
    ];
    const bundle = shapeAgentConfigBundle("org-1", filterBundleRowsForUser(rows, "me"), now);
    expect(bundle.rules.map((rule) => rule.name)).toEqual(["team-wide", "mine", "granted"]);
  });
});
