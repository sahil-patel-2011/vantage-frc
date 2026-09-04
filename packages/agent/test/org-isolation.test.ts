import { describe, expect, it } from "vitest";
import type { ChatAdapter, ContextItem } from "../src/index";
import {
  filterContextToOrg,
  isolationContextItem,
  isolateOrgChatInput,
  OrgIsolatedChatAdapter,
} from "../src/org-isolation";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const item = (id: string, content: string): ContextItem => ({
  type: "team_memory",
  id,
  importance: 10,
  content,
});

describe("org isolation", () => {
  it("keeps items that do not name an org, and drops another team's uuid", () => {
    const kept = filterContextToOrg(ORG_A, [
      item("note-1", "our climb time"),
      item(`${ORG_A}/memory`, "our auto"),
      item(`${ORG_B}/memory`, "their auto"),
      item(`org-isolation:${ORG_B}`, "leak"),
    ]);
    expect(kept.map((row) => row.id)).toEqual(["note-1", `${ORG_A}/memory`]);
  });

  it("tags every outbound request with exactly this org and no other", () => {
    const isolated = isolateOrgChatInput(ORG_A, {
      message: "Scout 254",
      context: [item(`${ORG_B}/memory`, "other team")],
    });
    expect(isolated.context[0]).toEqual(isolationContextItem(ORG_A));
    expect(isolated.context.some((row) => row.id.includes(ORG_B))).toBe(false);
    expect(isolated.context[0]!.content).toContain(ORG_A);
    expect(isolated.context[0]!.content).not.toContain(ORG_B);
  });

  it("wraps complete() so a caller cannot skip the filter", async () => {
    let seen: ContextItem[] = [];
    const inner: ChatAdapter = {
      provider: "openai-compatible",
      model: "glm/glm-5.3-flash",
      async complete(input) {
        seen = input.context;
        return { text: "ok", promptTokens: 1, completionTokens: 1, costUsd: 0 };
      },
    };
    const adapter = new OrgIsolatedChatAdapter(inner, ORG_A);
    await adapter.complete({
      message: "hello",
      context: [item(`${ORG_B}/secret`, "do not forward")],
    });
    expect(seen.some((row) => row.id.includes(ORG_B))).toBe(false);
    expect(seen[0]?.id).toBe(`org-isolation:${ORG_A}`);
    expect(adapter.model).toBe("glm/glm-5.3-flash");
  });
});
